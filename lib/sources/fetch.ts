import { after } from 'next/server';
import type { SourceAddon } from '../config';
import type { StreamRequest } from '../stremio';

/** Stream como chega dos addons de origem (formato livre, cada addon preenche campos diferentes). */
export type RawStream = {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: Record<string, unknown> & { filename?: string; videoSize?: number; bingeGroup?: string };
};

export type SourceResult = {
  source: SourceAddon;
  streams: RawStream[];
  ms: number;
  error?: string;
};

/** Respostas boas das fontes, por alguns minutos (abrir o mesmo título de novo não refaz as consultas) */
const SOURCE_CACHE_MS = 10 * 60_000;
const sourceCache = new Map<string, { at: number; streams: RawStream[] }>();

/**
 * Consulta um addon de origem. Sem o 'use cache' do Next: dentro dele, timeouts e erros chegavam
 * mascarados ("An error occurred in the Server Components render") e a fonte inteira se perdia em
 * produção (Comet, FrostStream, FenixFlix...). Aqui o cache é em memória e guarda só sucessos.
 */
/** How long a slow source may keep going after the answer left (it fills the cache for next time) */
const BACKGROUND_FETCH_MS = 25_000;
const inFlight = new Map<string, Promise<RawStream[]>>();

async function fetchSourceCached(manifestUrl: string, path: string, timeoutMs: number): Promise<RawStream[]> {
  const key = `${manifestUrl}|${path}`;
  const hit = sourceCache.get(key);
  if (hit && Date.now() - hit.at < SOURCE_CACHE_MS) return hit.streams;

  // The request runs with the long budget and fills the cache when it lands; the answer only waits
  // timeoutMs for it. A slow source (Comet: 13–17s) is thus in the list the next time the title opens.
  let request = inFlight.get(key);
  if (!request) {
    request = fetchSource(manifestUrl, path).then(
      streams => {
        if (sourceCache.size > 500) sourceCache.clear();
        sourceCache.set(key, { at: Date.now(), streams });
        return streams;
      },
    ).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    try {
      after(() => request!.catch(() => undefined));
    } catch {
      // outside a request (tests): nothing to keep alive
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSource(manifestUrl: string, path: string): Promise<RawStream[]> {
  const base = manifestUrl.replace(/\/manifest\.json$/, '');
  const res = await fetch(`${base}/stream/${path}.json`, {
    signal: AbortSignal.timeout(BACKGROUND_FETCH_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (OminStream)' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let body: { streams?: RawStream[] };
  try {
    body = JSON.parse(text) as { streams?: RawStream[] };
  } catch {
    throw new Error(`resposta não é JSON (${text.slice(0, 40).replace(/\s+/g, ' ')})`);
  }
  return Array.isArray(body.streams) ? body.streams : [];
}

/** Lista crua de uma fonte buscada pelo app (rede de casa), por nome da fonte */
export type RelayedSources = Record<string, { streams?: RawStream[]; error?: string; ms?: number }>;

/**
 * Consulta todas as fontes em paralelo; cada uma tem seu próprio timeout e falha isoladamente.
 * Fontes que o app já buscou ([relayed]) não são consultadas daqui: entram como vieram.
 * [onResult]: chamado com cada fonte assim que ela responde (ou falha), para a lista ir saindo aos poucos.
 */
export async function fetchAllSources(
  sources: SourceAddon[],
  req: StreamRequest,
  timeoutMs: number,
  relayed: RelayedSources = {},
  onResult?: (result: SourceResult) => void,
): Promise<SourceResult[]> {
  const path = `${req.type}/${req.stremioId}`;
  const relayedByName = new Map(Object.entries(relayed).map(([name, r]) => [name.toLowerCase(), r]));
  const fetchOne = async (source: SourceAddon): Promise<SourceResult> => {
    const fromApp = relayedByName.get(source.name.toLowerCase());
    if (fromApp) {
      const streams = Array.isArray(fromApp.streams) ? fromApp.streams : [];
      return { source, streams, ms: fromApp.ms ?? 0, ...(fromApp.error ? { error: `app: ${fromApp.error}` } : {}) };
    }
    const started = Date.now();
    try {
      const streams = await fetchSourceCached(source.url, path, timeoutMs);
      return { source, streams, ms: Date.now() - started };
    } catch (err) {
      const error = err instanceof Error ? (err.name === 'TimeoutError' ? 'timeout' : err.message) : 'erro';
      return { source, streams: [], ms: Date.now() - started, error };
    }
  };
  return Promise.all(
    sources.map(async source => {
      const result = await fetchOne(source);
      onResult?.(result);
      return result;
    }),
  );
}
