import { getConfig } from './config';
import { checkCached } from './debrid/torbox';
import { movieInfo, seriesEpisodeNames, seriesTitles } from './ids';
import { matchesEpisode, matchesLooseEpisode, matchesMovieTitle, matchesSeriesTitle } from './match';
import { isTheaterRecording } from './release';
import { dubMisaligned, findPair, originOf, probe, type Pair, type PairReport } from './pair';
import { pickByResolution, sortByQuality, sortByVideoFidelity } from './rank/sort';
import { fetchAllSources, type RelayedSources, type SourceResult } from './sources/fetch';
import { dedupe, normalize } from './sources/normalize';
import type { Stream, StreamRequest } from './stremio';
import type { Candidate } from './types';
import type { PlayPayload } from './play';
import { sealToken } from './token';
import { candidateInfo, pairInfo } from './presentation';
import { scoreText } from './verify/language';
import { verifyDubbed, type VerifyReport } from './verify/dubbed';
import { cleanupProbed, takeSnapshot } from './debrid/cleanup';
import { forgetPlayHash } from './play';

export type PipelineReport = {
  sources: { name: string; ms: number; streams: number; error?: string }[];
  normalized: number;
  deduped: number;
  /** descartados por serem de outra série/episódio ou de outro filme */
  mismatched: number;
  /** descartados por serem gravações de cinema (CAM, TELESYNC, TELECINE) */
  theaterRecordings: number;
  debrid: { total: number; cached: number; error?: string };
  audio: { likely: number; rejected: number };
  /** conferência das faixas de áudio das versões dubladas (ausente quando desligada) */
  verify?: VerifyReport;
  /** busca do "4K + áudio PT-BR" (ausente quando já existe 4K dublado) */
  pair?: PairReport;
  returned: number;
  ms: number;
};

/**
 * fontes → padronização → deduplicação → cache do TorBox → indícios de PT-BR → conferência das
 * faixas de áudio (o que vai para a lista) → ordenação.
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
  relayed: RelayedSources = {},
  onPartial?: (partial: PartialStreams) => void,
): Promise<{ streams: Stream[]; report: PipelineReport; cleanup?: (log?: (line: string) => void) => Promise<void> }> {
  const started = Date.now();
  const config = getConfig();
  // Foto da conta do TorBox antes de qualquer leitura de cabeçalho (base da limpeza)
  const cleanupOn = Boolean(config.TORBOX_API_KEY) && config.TORBOX_CLEANUP !== 'off';
  const snapshot = cleanupOn ? takeSnapshot(config.TORBOX_API_KEY!) : null;
  snapshot?.catch(() => {});

  // Títulos (para descartar outros filmes/episódios) e cache do TorBox: buscados uma vez e reaproveitados
  // pelas listas parciais e pela final
  const titleInfo = loadTitleInfo(req);
  titleInfo.catch(() => {});
  const cachedMemo = new Map<string, boolean>();

  // Listas parciais (rota /stream-live): a cada fonte que responde, a lista com o que já chegou, filtrada e
  // ordenada, sem a conferência de áudio nem o par (que precisam de todas). Uma por vez: as que chegam
  // enquanto uma é montada entram na próxima
  const arrived: SourceResult[] = [];
  let partials = Promise.resolve();
  let partialQueued = false;
  // A última lista enviada, sem os links (cada link /play é cifrado com um IV novo: a mesma opção
  // muda de URL a cada montagem). Uma fonte que não trouxe nada novo não gera outra parcial
  let lastPartial = '';
  const onResult = onPartial
    ? (result: SourceResult) => {
      arrived.push(result);
      if (partialQueued) return;
      partialQueued = true;
      partials = partials.then(async () => {
        partialQueued = false;
        const snapshot = [...arrived];
        try {
          const streams = await quickStreams(snapshot, req, playBase, titleInfo, cachedMemo);
          const signature = listSignature(streams);
          if (signature === lastPartial) return;
          lastPartial = signature;
          onPartial({ streams, done: snapshot.length, total: config.SOURCES.length });
        } catch {
          // uma parcial que falha não interrompe nada: a final sai do mesmo jeito
        }
      });
    }
    : undefined;

  const results = await fetchAllSources(config.SOURCES, req, config.SOURCE_TIMEOUT_MS, relayed, onResult);
  await partials;
  const normalized = normalize(results);
  let candidates = dedupe(normalized);

  // Gravações feitas no cinema: fora antes de qualquer consulta ao TorBox
  const beforeTheater = candidates.length;
  candidates = candidates.filter(c => !isTheaterRecording(`${c.filename ?? ''}\n${c.rawText}`));
  const theaterRecordings = beforeTheater - candidates.length;

  // Séries: descarta episódios de outras séries (spin-offs com nome parecido) e de outros episódios.
  // Filmes: descarta arquivos de outros filmes que as fontes devolvem por engano
  const beforeMatch = candidates.length;
  candidates = matchTitle(candidates, req, await titleInfo);
  const mismatched = beforeMatch - candidates.length;

  // Torrents: mantém só os que estão no cache do TorBox (tocam na hora)
  const kept = await keepCached(candidates, config.TORBOX_API_KEY, cachedMemo);
  candidates = kept.candidates;
  const debridReport: PipelineReport['debrid'] = kept.report;

  // Indícios de áudio PT-BR no texto: descarta o que não tem indício suficiente
  const scored = scoreAudio(candidates);
  const likely = scored.filter(c => c.audio.score >= config.HEURISTIC_MIN_SCORE);

  const sortedDubbed = sortByQuality(likely);

  // Arquivos lidos nesta busca (cada leitura pode adicionar o torrent à conta)
  const probed = new Map<string, Candidate>();
  const payloadOf = (c: Candidate) => {
    if (c.infoHash) probed.set(c.infoHash.toLowerCase(), c);
    return playPayload(c, req);
  };
  // As leituras só começam depois da foto (ou da falha dela): assim a foto não inclui o que elas adicionam
  if (snapshot) await snapshot.catch(() => null);

  // Sem 4K dublado: tenta juntar o vídeo de um 4K sem dublagem com o áudio de uma versão dublada.
  // Sem par 4K: o mesmo com o 1080p de melhor imagem (remux), se ele for melhor que o 1080p dublado
  // (corre junto com a conferência: as duas leem cabeçalhos e dividem o mesmo cache)
  const pairSearch = (async (): Promise<{ pair: Pair | null; report?: PairReport }> => {
    if (!config.PAIR_ENABLED || likely.some(c => (c.resolution ?? 0) >= 1440) || !sortedDubbed.length) return { pair: null };
    const undubbed = scored.filter(c => c.audio.score < config.HEURISTIC_MIN_SCORE);
    const uhd = sortByVideoFidelity(undubbed.filter(c => (c.resolution ?? 0) >= 2160));
    const uhdSearch = uhd.length ? await findPair(uhd, sortedDubbed, payloadOf, clientIp) : null;
    if (uhdSearch?.pair || uhdSearch?.report.timedOut) return uhdSearch;

    // Só vale juntar se a imagem vier de uma fonte melhor (remux > BluRay > WEB): codec ou tamanho
    // sozinhos não justificam trocar um 1080p dublado de verdade por um par
    const sourceTier = (c: Candidate) => (c.remux ? 3 : { bluray: 2, web: 1, hdtv: 0, other: 0 }[originOf(textOf(c))]);
    const dubbedTier = Math.max(-1, ...likely.filter(c => c.resolution === 1080).map(sourceTier));
    const fhd = sortByVideoFidelity(undubbed.filter(c => c.resolution === 1080 && sourceTier(c) > dubbedTier));
    if (!fhd.length) return uhdSearch ?? { pair: null };
    const fhdSearch = await findPair(fhd, sortedDubbed, payloadOf, clientIp);
    if (!uhdSearch) return fhdSearch;
    // Relatório único: as tentativas do 4K e depois as do 1080p
    const { report } = fhdSearch;
    return {
      pair: fhdSearch.pair,
      report: {
        ...report,
        videos: [...uhdSearch.report.videos, ...report.videos],
        attempts: [...uhdSearch.report.attempts, ...report.attempts],
        ms: uhdSearch.report.ms + report.ms,
      },
    };
  })();

  // O nome pode dizer "Dublado" e o arquivo não ter a faixa: confere o que entraria na lista
  const verification = config.VERIFY_AUDIO_ENABLED && config.TORBOX_API_KEY
    ? await verifyDubbed(sortedDubbed, {
      quotas: config.RESULTS_PER_RESOLUTION,
      maxProbes: config.VERIFY_AUDIO_MAX,
      budgetMs: config.VERIFY_AUDIO_BUDGET_MS,
      readAudio: async c => {
        const probed = await probe(c, payloadOf(c), clientIp);
        const { ptAudio, noPtAudio, audio } = probed;
        if (ptAudio && dubMisaligned(probed)) return { verdict: 'misaligned', audio };
        return { verdict: ptAudio ? 'pt-br' : noPtAudio ? 'other' : 'unknown', audio };
      },
    })
    : null;
  const dubbed = verification?.kept ?? sortedDubbed;
  const ranked = pickByResolution(dubbed, config.RESULTS_PER_RESOLUTION);
  const { pair, report: pairReport } = await pairSearch;

  // A primeira opção da lista (o par, quando existe) é a recomendada
  const streams = ranked.map((c, i) => toStream(c, req, playBase, { recommended: !pair && i === 0 }));
  if (pair) streams.unshift(toPairStream(pair, req, playBase));

  // 4K sem dublagem, com o áudio original: no fim, para quem prefere a imagem à dublagem
  let undubbed: Candidate[] = [];
  if (config.UNDUBBED_4K_RESULTS > 0) {
    undubbed = sortByQuality(
      scored.filter(c => c.audio.score < config.HEURISTIC_MIN_SCORE && (c.resolution ?? 0) >= 2160),
    ).slice(0, config.UNDUBBED_4K_RESULTS);
    streams.push(...undubbed.map(c => toStream(c, req, playBase, { undubbed: true })));
  }

  // Em segundo plano, depois da resposta: tira da conta o que foi adicionado só para ler e não
  // entrou na lista (o que está na lista fica: o autoplay pode estar tocando)
  const listedHashes = [...ranked, ...undubbed, ...(pair ? [pair.video, pair.audio] : [])]
    .map(c => c.infoHash)
    .filter((h): h is string => Boolean(h));
  const cleanup = snapshot
    ? (log?: (line: string) => void) => cleanupProbed({
      apiKey: config.TORBOX_API_KEY!,
      mode: config.TORBOX_CLEANUP,
      snapshot,
      sessionStart: started,
      // As leituras que estouraram o tempo seguem rodando: espera todas (estão no cache do probe)
      probesDone: Promise.allSettled([...probed.values()].map(c => probe(c, playPayload(c, req), clientIp))),
      probedHashes: () => probed.keys(),
      listedHashes,
      protectedHashes: config.TORBOX_PROTECTED_HASHES,
      onRemoved: forgetPlayHash,
      log,
    })
    : undefined;

  return {
    cleanup,
    streams,
    report: {
      sources: results.map(r => ({ name: r.source.name, ms: r.ms, streams: r.streams.length, error: r.error })),
      normalized: normalized.length,
      deduped: dedupe(normalized).length,
      mismatched,
      theaterRecordings,
      debrid: debridReport,
      audio: { likely: likely.length, rejected: scored.length - likely.length },
      verify: verification?.report,
      pair: pairReport,
      returned: streams.length,
      ms: Date.now() - started,
    },
  };
}

/** Uma lista parcial: o que já chegou de `done` das `total` fontes. */
export type PartialStreams = { streams: Stream[]; done: number; total: number };

type TitleInfo =
  | { kind: 'series'; titles: string[]; episodeNames: Awaited<ReturnType<typeof seriesEpisodeNames>> }
  | { kind: 'movie'; info: Awaited<ReturnType<typeof movieInfo>> }
  | { kind: 'none' };

async function loadTitleInfo(req: StreamRequest): Promise<TitleInfo> {
  if (req.type === 'series' && req.season !== undefined && req.episode !== undefined) {
    const [titles, episodeNames] = await Promise.all([seriesTitles(req.imdbId), seriesEpisodeNames(req.imdbId)]);
    return { kind: 'series', titles, episodeNames };
  }
  if (req.type === 'movie') return { kind: 'movie', info: await movieInfo(req.imdbId) };
  return { kind: 'none' };
}

/** Só o que é deste título: o episódio certo da série certa, ou o filme certo. */
function matchTitle(candidates: Candidate[], req: StreamRequest, info: TitleInfo): Candidate[] {
  if (info.kind === 'series') {
    return candidates.filter(
      c =>
        matchesSeriesTitle(c.filename, info.titles) !== false &&
        matchesEpisode(c.filename, req.season!, req.episode!) &&
        matchesLooseEpisode(c.filename, req.season!, req.episode!, info.episodeNames, c.rawText),
    );
  }
  if (info.kind === 'movie') {
    const { titles, year, siblings } = info.info;
    return candidates.filter(c => matchesMovieTitle(c.filename, titles, { year, siblings }) !== false);
  }
  return candidates;
}

/**
 * Torrents: só os que estão no cache do TorBox. [memo] guarda a resposta por hash: as listas parciais e a
 * final consultam cada hash uma vez só.
 */
async function keepCached(
  candidates: Candidate[],
  apiKey: string | undefined,
  memo: Map<string, boolean>,
): Promise<{ candidates: Candidate[]; report: PipelineReport['debrid'] }> {
  const hashes = [...new Set(candidates.filter(c => c.kind === 'debrid' && c.infoHash).map(c => c.infoHash!.toLowerCase()))];
  const report: PipelineReport['debrid'] = { total: hashes.length, cached: 0 };
  if (!apiKey || !hashes.length) return { candidates, report };
  try {
    const unknown = hashes.filter(h => !memo.has(h));
    if (unknown.length) {
      const cached = await checkCached(apiKey, unknown);
      for (const h of unknown) memo.set(h, cached.has(h));
    }
    report.cached = hashes.filter(h => memo.get(h)).length;
    return {
      candidates: candidates
        .map(c => (c.kind === 'debrid' && c.infoHash ? { ...c, cached: memo.get(c.infoHash.toLowerCase()) === true } : c))
        .filter(c => c.kind !== 'debrid' || c.cached),
      report,
    };
  } catch (err) {
    // Sem resposta do TorBox: confia na indicação dos próprios addons
    report.error = err instanceof Error ? err.message : 'erro';
    return { candidates: candidates.filter(c => c.kind !== 'debrid' || c.cachedHint), report };
  }
}

function scoreAudio(candidates: Candidate[]) {
  const groups = getConfig().BR_RELEASE_GROUPS;
  return candidates.map(c => ({ ...c, audio: scoreText(`${c.filename ?? ''}\n${c.rawText}`, groups) }));
}

/** A lista com as fontes que já responderam: os mesmos filtros e a mesma ordem da final, sem conferência nem par. */
/** O que o app mostra de cada opção, na ordem: igual = mesma lista (o link fica de fora) */
export function listSignature(streams: Stream[]): string {
  return JSON.stringify(streams.map(s => [s.name, s.title, s.description, s.behaviorHints?.filename, s.behaviorHints?.videoSize]));
}

async function quickStreams(
  results: SourceResult[],
  req: StreamRequest,
  playBase: string,
  titleInfo: Promise<TitleInfo>,
  memo: Map<string, boolean>,
): Promise<Stream[]> {
  const config = getConfig();
  let candidates = dedupe(normalize(results)).filter(c => !isTheaterRecording(`${c.filename ?? ''}\n${c.rawText}`));
  candidates = matchTitle(candidates, req, await titleInfo);
  candidates = (await keepCached(candidates, config.TORBOX_API_KEY, memo)).candidates;
  const likely = scoreAudio(candidates).filter(c => c.audio.score >= config.HEURISTIC_MIN_SCORE);
  const ranked = pickByResolution(sortByQuality(likely), config.RESULTS_PER_RESOLUTION);
  return ranked.map((c, i) => toStream(c, req, playBase, { recommended: i === 0 }));
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

const textOf = (c: Candidate) => c.filename ?? c.rawText;

const qualityLabel = (c: Candidate) =>
  [c.resolution ? RES_LABEL[c.resolution] : '?', ...c.hdr.filter(h => h !== 'HDR' || c.hdr.length === 1)].join(' ');

const techLabel = (c: Candidate) =>
  [formatSize(c.sizeBytes), c.remux ? 'REMUX' : undefined, c.codec?.toUpperCase()].filter(Boolean).join(' · ');

/** Converte para o formato de stream exibido pelo Nuvio/Stremio. */
function toStream(
  c: Candidate,
  req: StreamRequest,
  playBase: string,
  { undubbed = false, recommended = false } = {},
): Stream {
  const quality = qualityLabel(c);
  const tech = techLabel(c);
  const origin = c.kind === 'debrid' ? '⚡ TorBox' : c.kind === 'hls' ? '📡 HLS' : '🔗 Direto';
  const description = [c.filename, tech && `💾 ${tech}`, `${origin} · ${c.sources.join(', ')}`].filter(Boolean).join('\n');

  const confidence = undubbed
    ? '🌐 Sem PT-BR (áudio original)'
    : c.audioVerified ? '🇧🇷 PT-BR conferido'
      : (c.audio?.score ?? 0) >= 70 ? '🇧🇷 PT-BR declarado' : '◉ PT-BR provável';

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
      ...(undubbed ? {} : { ominstream: candidateInfo(c, recommended) }),
    },
  };
}

/**
 * Stream do par: o vídeo vem do 4K e o áudio PT-BR da versão dublada (behaviorHints.audioUrl,
 * extensão entendida pelo fork do Nuvio TV). Players sem suporte tocam só o 4K, sem dublagem.
 */
function toPairStream(pair: Pair, req: StreamRequest, playBase: string): Stream {
  const { video, audio, diffMs, approximate } = pair;
  const tech = techLabel(video);
  const seconds = (diffMs / 1000).toFixed(1).replace('.', ',');
  const sync = !pair.verified
    ? '⚠️ Duração não conferida (link direto): o player sincroniza pelo som; se precisar, ajuste o atraso'
    : approximate
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
      // Link direto: o app busca da rede de casa (o site recusa a Vercel, então não passa pelo /play)
      audioUrl: audio.kind === 'http' ? audio.url : playUrl(audio, req, playBase),
      ominstream: pairInfo(pair, true),
    },
  };
}
