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
 * Falhas não entram no cache: lançam erro e são tratadas por quem chamou.
 */
async function fetchSourceCached(manifestUrl: string, path: string, timeoutMs: number): Promise<RawStream[]> {
  'use cache';
  cacheLife({ stale: 300, revalidate: 600, expire: 1800 });

  const base = manifestUrl.replace(/\/manifest\.json$/, '');
  const res = await fetch(`${base}/stream/${path}.json`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'Mozilla/5.0 (OminStream)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { streams?: RawStream[] };
  return Array.isArray(body.streams) ? body.streams : [];
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
