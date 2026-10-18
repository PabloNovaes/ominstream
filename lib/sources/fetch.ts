import { cacheLife } from 'next/cache';
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

/**
 * Consulta um addon de origem. O resultado fica em cache por alguns minutos
 * (abrir o mesmo título de novo não refaz as 9 consultas).
 * Falhas voltam como { error } com cache de poucos segundos: lançar dentro do 'use cache' fazia a
 * mensagem chegar mascarada em produção ("An error occurred in the Server Components render").
 */
async function fetchSourceCached(
  manifestUrl: string,
  path: string,
  timeoutMs: number,
): Promise<{ streams: RawStream[] } | { error: string }> {
  'use cache';
  try {
    const base = manifestUrl.replace(/\/manifest\.json$/, '');
    const res = await fetch(`${base}/stream/${path}.json`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'Mozilla/5.0 (OminStream)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let body: { streams?: RawStream[] };
    try {
      body = JSON.parse(text) as { streams?: RawStream[] };
    } catch {
      throw new Error(`resposta não é JSON (${text.slice(0, 40).replace(/\s+/g, ' ')})`);
    }
    cacheLife({ stale: 300, revalidate: 600, expire: 1800 });
    return { streams: Array.isArray(body.streams) ? body.streams : [] };
  } catch (err) {
    cacheLife('seconds');
    const error = err instanceof Error ? (err.name === 'TimeoutError' ? 'timeout' : err.message) : 'erro';
    return { error };
  }
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
        const result = await fetchSourceCached(source.url, path, timeoutMs);
        if ('error' in result) return { source, streams: [], ms: Date.now() - started, error: result.error };
        return { source, streams: result.streams, ms: Date.now() - started };
      } catch (err) {
        const error = err instanceof Error ? (err.name === 'TimeoutError' ? 'timeout' : err.message) : 'erro';
        return { source, streams: [], ms: Date.now() - started, error };
      }
    }),
  );
}
