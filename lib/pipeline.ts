import { getConfig } from './config';
import { checkCached } from './debrid/torbox';
import { seriesTitles } from './ids';
import { matchesEpisode, matchesSeriesTitle } from './match';
import { findPair, type Pair, type PairReport } from './pair';
import { pickByResolution, sortByQuality } from './rank/sort';
import { fetchAllSources } from './sources/fetch';
import { dedupe, normalize } from './sources/normalize';
import type { Stream, StreamRequest } from './stremio';
import type { Candidate } from './types';
import type { PlayPayload } from './play';
import { sealToken } from './token';
import { scoreText } from './verify/language';

export type PipelineReport = {
  sources: { name: string; ms: number; streams: number; error?: string }[];
  normalized: number;
  deduped: number;
  /** episódios descartados por serem de outra série ou de outro episódio */
  mismatched: number;
  debrid: { total: number; cached: number; error?: string };
  audio: { likely: number; rejected: number };
  /** busca do "4K + áudio PT-BR" (ausente quando já existe 4K dublado) */
  pair?: PairReport;
  returned: number;
  ms: number;
};

/**
 * fontes → padronização → deduplicação → cache do TorBox → indícios de PT-BR → ordenação.
 * (A verificação real das faixas no play entra na próxima etapa da Fase 4.)
 */
/**
 * @param playBase endereço público + segredo ("https://host/<segredo>"): os streams via TorBox
 *   apontam para a rota /play do OminStream, que resolve o link no servidor.
 * @param clientIp IP de quem assiste: a checagem do par resolve os links como o /play faria
 *   (mesmo CDN), e o /play depois reaproveita esses links.
 */
export async function getStreams(
  req: StreamRequest,
  playBase: string,
  clientIp?: string,
): Promise<{ streams: Stream[]; report: PipelineReport }> {
  const started = Date.now();
  const config = getConfig();

  const results = await fetchAllSources(config.SOURCES, req, config.SOURCE_TIMEOUT_MS);
  const normalized = normalize(results);
  let candidates = dedupe(normalized);

  // Séries: descarta episódios de outras séries (spin-offs com nome parecido) e de outros episódios
  let mismatched = 0;
  if (req.type === 'series' && req.season !== undefined && req.episode !== undefined) {
    const titles = await seriesTitles(req.imdbId);
    const before = candidates.length;
    candidates = candidates.filter(
      c => matchesSeriesTitle(c.filename, titles) !== false && matchesEpisode(c.filename, req.season!, req.episode!),
    );
    mismatched = before - candidates.length;
  }

  // Torrents: mantém só os que estão no cache do TorBox (tocam na hora)
  const debridHashes = candidates.filter(c => c.kind === 'debrid' && c.infoHash).map(c => c.infoHash!);
  const debridReport: PipelineReport['debrid'] = { total: new Set(debridHashes).size, cached: 0 };
  if (config.TORBOX_API_KEY && debridHashes.length) {
    try {
      const cached = await checkCached(config.TORBOX_API_KEY, debridHashes);
      debridReport.cached = cached.size;
      candidates = candidates
        .map(c => (c.kind === 'debrid' && c.infoHash ? { ...c, cached: cached.has(c.infoHash) } : c))
        .filter(c => c.kind !== 'debrid' || c.cached);
    } catch (err) {
      // Sem resposta do TorBox: confia na indicação dos próprios addons
      debridReport.error = err instanceof Error ? err.message : 'erro';
      candidates = candidates.filter(c => c.kind !== 'debrid' || c.cachedHint);
    }
  }

  // Indícios de áudio PT-BR no texto: descarta o que não tem indício suficiente
  const scored = candidates.map(c => ({
    ...c,
    audio: scoreText(`${c.filename ?? ''}\n${c.rawText}`, config.BR_RELEASE_GROUPS),
  }));
  const likely = scored.filter(c => c.audio.score >= config.HEURISTIC_MIN_SCORE);

  const dubbed = sortByQuality(likely);
  const ranked = pickByResolution(dubbed, config.RESULTS_PER_RESOLUTION);

  // Sem 4K dublado: tenta juntar o vídeo de um 4K sem dublagem com o áudio de uma versão dublada
  let pair: Pair | null = null;
  let pairReport: PairReport | undefined;
  if (config.PAIR_ENABLED && !likely.some(c => (c.resolution ?? 0) >= 1440)) {
    const videos = sortByQuality(
      scored.filter(c => c.audio.score < config.HEURISTIC_MIN_SCORE && (c.resolution ?? 0) >= 2160),
    );
    if (videos.length && dubbed.length) {
      ({ pair, report: pairReport } = await findPair(videos, dubbed, c => playPayload(c, req), clientIp));
    }
  }

  const streams = ranked.map(c => toStream(c, req, playBase));
  if (pair) streams.unshift(toPairStream(pair, req, playBase));

  return {
    streams,
    report: {
      sources: results.map(r => ({ name: r.source.name, ms: r.ms, streams: r.streams.length, error: r.error })),
      normalized: normalized.length,
      deduped: dedupe(normalized).length,
      mismatched,
      debrid: debridReport,
      audio: { likely: likely.length, rejected: scored.length - likely.length },
      pair: pairReport,
      returned: streams.length,
      ms: Date.now() - started,
    },
  };
}

const RES_LABEL: Record<number, string> = { 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 576: '576p', 480: '480p' };

/** Base 1024, como os addons e players exibem ("69.5 GB" = 69.5 GiB). */
function formatSize(bytes?: number) {
  if (!bytes) return undefined;
  return bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(1)} GB` : `${Math.round(bytes / 2 ** 20)} MB`;
}

/**
 * Link entregue ao app. Torrents via TorBox passam pela rota /play: o servidor resolve o link
 * na hora do play (evita a trava de IP da ElfHosted e esconde a chave do TorBox).
 * Links diretos/HLS seguem como vieram (podem depender de cabeçalhos do próprio app).
 */
function playUrl(c: Candidate, req: StreamRequest, playBase: string): string {
  if (c.kind !== 'debrid') return c.url;
  return `${playBase}/play/${sealToken(playPayload(c, req))}`;
}

function playPayload(c: Candidate, req: StreamRequest): PlayPayload {
  return {
    u: c.url,
    s: c.urlSource,
    h: c.infoHash,
    i: c.fileIdx,
    f: c.filename,
    t: req.type,
    id: req.stremioId,
  };
}

const qualityLabel = (c: Candidate) =>
  [c.resolution ? RES_LABEL[c.resolution] : '?', ...c.hdr.filter(h => h !== 'HDR' || c.hdr.length === 1)].join(' ');

const techLabel = (c: Candidate) =>
  [formatSize(c.sizeBytes), c.remux ? 'REMUX' : undefined, c.codec?.toUpperCase()].filter(Boolean).join(' · ');

/** Converte para o formato de stream exibido pelo Nuvio/Stremio. */
function toStream(c: Candidate, req: StreamRequest, playBase: string): Stream {
  const quality = qualityLabel(c);
  const tech = techLabel(c);
  const origin = c.kind === 'debrid' ? '⚡ TorBox' : c.kind === 'hls' ? '📡 HLS' : '🔗 Direto';
  const description = [c.filename, tech && `💾 ${tech}`, `${origin} · ${c.sources.join(', ')}`].filter(Boolean).join('\n');

  const confidence = (c.audio?.score ?? 0) >= 70 ? '🇧🇷 PT-BR declarado' : '◉ PT-BR provável';

  return {
    name: `OminStream\n${quality}\n${confidence}`,
    title: description,
    description,
    url: playUrl(c, req, playBase),
    behaviorHints: {
      ...c.passthroughHints,
      bingeGroup: `ominstream|${c.resolution ?? 'na'}|${c.hdr.join('-')}`,
      filename: c.filename,
      videoSize: c.sizeBytes,
    },
  };
}

/**
 * Stream do par: o vídeo vem do 4K e o áudio PT-BR da versão dublada (behaviorHints.audioUrl,
 * extensão entendida pelo fork do Nuvio TV). Players sem suporte tocam só o 4K, sem dublagem.
 */
function toPairStream({ video, audio, diffMs, approximate }: Pair, req: StreamRequest, playBase: string): Stream {
  const tech = techLabel(video);
  const seconds = (diffMs / 1000).toFixed(1).replace('.', ',');
  const sync = approximate
    ? `⚠️ Durações diferem em ${seconds} s: se o áudio dessincronizar, ajuste o atraso de áudio no player`
    : `⏱ Durações batem (diferença de ${diffMs} ms)`;
  const description = [
    video.filename,
    tech && `💾 ${tech}`,
    `🔊 Áudio PT-BR: ${audio.filename ?? '?'}`,
    `${sync} · ⚡ TorBox`,
  ].filter(Boolean).join('\n');

  return {
    name: `OminStream\n${qualityLabel(video)}\n${approximate ? '⚠️' : '🇧🇷'} Áudio de outra fonte`,
    title: description,
    description,
    url: playUrl(video, req, playBase),
    behaviorHints: {
      ...video.passthroughHints,
      bingeGroup: `ominstream|pair|${video.resolution ?? 'na'}|${video.hdr.join('-')}`,
      filename: video.filename,
      videoSize: video.sizeBytes,
      audioUrl: playUrl(audio, req, playBase),
    },
  };
}
