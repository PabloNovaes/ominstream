import { tmdbToImdb } from './ids';
import type { PipelineReport } from './pipeline';
import type { RelayedSources } from './sources/fetch';
import { parseStreamRequest, toStreamRequest, type StreamRequest } from './stremio';

/**
 * O pedido de streams como chega nas rotas /stream e /stream-live: o ID do IMDb já resolvido, ou o motivo
 * de não haver o que buscar (a rota responde lista vazia, não erro: para o app, erro HTTP vira "um erro ocorreu").
 */
export async function resolveStreamRequest(
  type: string,
  id: string,
): Promise<{ request: StreamRequest; rawId: string } | { empty: string; rawId: string }> {
  const rawId = decodeURIComponent(id).replace(/\.json$/, '');
  const incoming = parseStreamRequest(type, id);
  if (!incoming) return { empty: 'formato de ID não reconhecido', rawId };
  // Títulos do catálogo do TMDB chegam como "tmdb:<id>": as fontes só entendem IMDb
  const imdbId = incoming.idType === 'imdb' ? incoming.baseId : await tmdbToImdb(incoming.type, incoming.baseId);
  if (!imdbId) return { empty: 'sem ID do IMDb correspondente', rawId };
  return { request: toStreamRequest(incoming, imdbId), rawId };
}

/** O corpo do POST: { relayed: { <fonte>: { streams } } }, as listas que o app buscou da rede de casa. */
export async function readRelayed(req: Request): Promise<RelayedSources> {
  try {
    const body = (await req.json()) as { relayed?: RelayedSources };
    if (body && typeof body.relayed === 'object' && body.relayed) return body.relayed;
  } catch {
    // corpo inválido: segue como um GET
  }
  return {};
}

/** Uma linha por busca no log da Vercel: tempo, volume de cada fonte, conferência e par. */
export function logStreams(route: string, type: string, rawId: string, request: StreamRequest, report: PipelineReport) {
  console.log(
    `[${route}] ${type}/${rawId} → ${request.stremioId} · ${report.returned} streams em ${report.ms}ms · ` +
      report.sources.map(s => `${s.name}:${s.error ?? s.streams}`).join(' ') +
      (report.verify
        ? ` · áudio conferido: ${report.verify.confirmed} ok, ${report.verify.untagged} sem etiqueta, ${report.verify.rejected.length} sem PT-BR` +
          `${report.verify.misaligned.length ? `, ${report.verify.misaligned.length} com PT-BR fora do vídeo` : ''}` +
          `${report.verify.timedOut ? ', tempo esgotado' : ''} (${report.verify.ms}ms)`
        : '') +
      (report.pair ? ` · par 4K: ${report.pair.chosen ? 'ok' : report.pair.timedOut ? 'tempo esgotado' : 'não'} (${report.pair.ms}ms)` : ''),
  );
}
