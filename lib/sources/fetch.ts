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
async function fetchSourceCached(manifestUrl: string, path: string, timeoutMs: number): Promise<RawStream[]> {
  const key = `${manifestUrl}|${path}`;
  const hit = sourceCache.get(key);
  if (hit && Date.now() - hit.at < SOURCE_CACHE_MS) return hit.streams;

  const base = manifestUrl.replace(/\/manifest\.json$/, '');
  const res = await fetch(`${base}/stream/${path}.json`, {
    signal: AbortSignal.timeout(timeoutMs),
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
  const streams = Array.isArray(body.streams) ? body.streams : [];
  if (sourceCache.size > 500) sourceCache.clear();
  sourceCache.set(key, { at: Date.now(), streams });
  return streams;
}

/** Consulta todas as fontes em paralelo; cada uma tem seu próprio timeout e falha isoladamente. */
export async function fetchAllSources(
  sources: SourceAddon[],
  req: StreamRequest,
  timeoutMs: number,
): Promise<SourceResult[]> {
  const path = `${req.type}/${req.stremioId}`;
  return Promise.all(
    sources.map(async source => {
      const started = Date.now();
      try {
        const streams = await fetchSourceCached(source.url, path, timeoutMs);
        return { source, streams, ms: Date.now() - started };
      } catch (err) {
        const error = err instanceof Error ? (err.name === 'TimeoutError' ? 'timeout' : err.message) : 'erro';
        return { source, streams: [], ms: Date.now() - started, error };
      }
    }),
  );
}
