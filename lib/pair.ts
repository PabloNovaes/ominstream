import { getConfig } from './config';
import { playKey, resolvePlayCached, type PlayPayload } from './play';
import type { Candidate } from './types';
import { classifyTrack, isAmbiguousPortuguese, type TrackVerdict } from './verify/language';
import { readTracks } from './verify/tracks';

/**
 * "4K + áudio PT-BR": quando não há 4K dublado, junta o vídeo de um 4K sem dublagem com o
 * áudio de uma versão dublada (o app toca os dois juntos via behaviorHints.audioUrl).
 *
 * O par só é oferecido se as DURAÇÕES e as VELOCIDADES baterem. A duração pega cortes diferentes
 * (versão estendida, mais longa) e a dublagem PAL a 25 fps (~4% mais curta). A velocidade vem da
 * taxa de quadros do cabeçalho: 23,976 × 24 qps é só 0,1%, e um atraso no início da faixa basta
 * para a duração total bater (Loki T1E1: BluRay a 23,976 com um WEBRip a 24 e o inglês atrasado
 * 2,985 s; o áudio escorrega de 2,8 s até 0 ao longo do episódio). Vinhetas diferentes na mesma
 * velocidade passam: o ajuste de atraso do player cobre esse caso.
 */

export type Origin = 'bluray' | 'web' | 'hdtv' | 'other';

export function originOf(text: string): Origin {
  const t = text.toLowerCase();
  if (/\b(blu[ ._-]?ray|bdrip|brrip|bdremux|remux|uhd[ ._-]?bd)\b/.test(t)) return 'bluray';
  if (/\bweb[ ._-]?(dl|rip)?\b/.test(t)) return 'web';
  if (/\bhdtv\b/.test(t)) return 'hdtv';
  return 'other';
}

// Cortes que mudam o conteúdo (IMAX/remaster mudam só a imagem: o áudio continua servindo)
const EDITIONS: [string, RegExp][] = [
  ['extended', /\bextended\b|\bestendid[ao]\b/i],
  ['directors', /director'?s?[ ._-]?cut|vers[aã]o[ ._-]do[ ._-]diretor/i],
  ['unrated', /\bunrated\b|\buncut\b/i],
];

export function editionOf(text: string): string {
  return EDITIONS.filter(([, re]) => re.test(text)).map(([name]) => name).join('+');
}

const textOf = (c: Candidate) => c.filename ?? c.rawText;

/** Manifesto de stream segmentado (DASH .mpd, HLS .m3u8), pelo nome ou pelo link */
export const isSegmentedManifest = (c: Pick<Candidate, 'filename' | 'url'>) =>
  /\.(mpd|m3u8)(\?|#|$)/i.test(c.filename ?? '') || /\.(mpd|m3u8)(\?|#|$)/i.test(c.url ?? '');

/**
 * Parceiros de áudio para um vídeo, na ordem de tentativa: mesmo corte obrigatório,
 * mesma origem primeiro (BluRay com BluRay é o caso mais seguro) e itens sem nome de arquivo
 * por último (pacotes, em que nem sempre dá para saber qual é o vídeo). `dubbed` já vem ordenado.
 */
export function audioPartners(video: Candidate, dubbed: Candidate[]): Candidate[] {
  // 4K sem origem no nome é quase sempre rip de UHD BluRay
  const declared = originOf(textOf(video));
  const origin = declared === 'other' && (video.resolution ?? 0) >= 2160 ? 'bluray' : declared;
  const edition = editionOf(textOf(video));
  // Torrents no TorBox e links diretos (FenixFlix etc., buscados pelo app). Streams segmentados não servem de
  // áudio: o player busca pedaço por pedaço num servidor de terceiros, sem buffer, e o áudio fica sem dados
  // (Dragon Ball Super Beerus: .mpd de DASH como áudio, "Audio device underrun" e travadas)
  const compatible = dubbed.filter(c =>
    (c.kind === 'debrid' || (c.kind === 'http' && !isSegmentedManifest(c))) && editionOf(textOf(c)) === edition);
  // Só "Portuguese" sem sinal de Brasil pode ser a dublagem de Portugal: fica por último. "Dual"
  // primeiro: com o idioma original junto, o app sincroniza comparando o mesmo idioma. Links
  // diretos depois dos torrents (nem sempre dá para conferir a duração)
  const isDual = (c: Candidate) => /\b(dual|multi)\b/i.test(textOf(c));
  const rank = (c: Candidate) =>
    (isAmbiguousPortuguese(textOf(c)) ? 8 : 0) + (c.kind === 'http' ? 4 : 0) + (c.filename ? 0 : 2) +
    (isDual(c) ? 0 : 1) + (originOf(textOf(c)) === origin ? 0 : 1);
  return compatible
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

// --- Quais 4K tentar ---------------------------------------------------------------------

/** Quanto a busca do par espera pelas velocidades antes de começar a testar (o par inteiro tem PAIR_BUDGET_MS) */
const SPEED_WAIT_MS = 2500;
const delay = (ms: number) => new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms));

// Além dos melhores no geral, os melhores com a origem das dublagens: BluRay a 23,976 qps não combina
// com dublagem de streaming a 24 (Loki T1E1: os 3 melhores 4K eram BluRay e o 4K do Disney+ nem era testado)
const SAME_ORIGIN_EXTRA = 2;

/** Os 4K a testar: os `max` melhores e até dois a mais com a origem das dublagens. `videos` já vem ordenado. */
export function pairVideoPool(videos: Candidate[], dubbed: Candidate[], max: number): Candidate[] {
  const top = videos.slice(0, max);
  const dubOrigins = new Set<Origin>(dubbed.map(c => originOf(textOf(c))).filter(o => o !== 'other'));
  // MKV primeiro também aqui (ver mp4Penalty): os dois melhores WEB do Loki eram MP4 e o MKV do Disney+ ficava de fora
  const extra = videos
    .slice(max)
    .filter(v => dubOrigins.has(originOf(textOf(v))))
    .map((v, i) => ({ v, i }))
    .sort((x, y) => mp4Penalty(x.v) - mp4Penalty(y.v) || x.i - y.i)
    .map(x => x.v)
    .slice(0, SAME_ORIGIN_EXTRA);
  return [...top, ...extra];
}

/**
 * Ordem de tentativa pela velocidade: primeiro os 4K na velocidade de alguma dublagem PT-BR (na ordem de
 * qualidade); os que não combinam com nenhuma ficam de fora (nenhum atraso fixo os sincronizaria).
 * Velocidade desconhecida, de um lado ou de todos os dublados, não decide nada: o vídeo fica, depois dos que combinam.
 */
export function orderBySpeed<T>(
  videos: T[],
  fpsOf: (v: T) => number | undefined,
  dubFps: (number | undefined)[],
  /** dentro de cada grupo, quem tem nota maior vai depois (ordem de qualidade mantida no empate) */
  penalty: (v: T) => number = () => 0,
): T[] {
  const known = dubFps.filter((f): f is number => !!f);
  const matches = (v: T) => {
    const fps = fpsOf(v);
    if (!fps || !known.length) return undefined;
    return known.some(d => sameSpeed(fps, d));
  };
  const byPenalty = (list: T[]) => list.map((v, i) => ({ v, i })).sort((a, b) => penalty(a.v) - penalty(b.v) || a.i - b.i).map(x => x.v);
  return [...byPenalty(videos.filter(v => matches(v) === true)), ...byPenalty(videos.filter(v => matches(v) === undefined))];
}

/**
 * MP4 vai depois de MKV: num MP4 as faixas podem ficar longe umas das outras no arquivo (Loki T1E1, DVT: legendas
 * russas a ~340 MB e o vídeo do mesmo instante a ~2,2 GB), e o player lê todas, indo e voltando, descartando o
 * que já tinha baixado à frente; o vídeo travava com a rede sobrando. MKV vem intercalado.
 */
export const mp4Penalty = (c: Pick<Candidate, 'filename' | 'rawText'>) =>
  /\.(mp4|m4v|mov)$/i.test(c.filename ?? c.rawText) ? 1 : 0;

// --- Leitura do arquivo (duração e faixas) ---------------------------------------------

/**
 * `ptAudio`: tem faixa PT-BR confirmada. `noPtAudio`: todas as faixas têm idioma marcado e nenhum é
 * PT-BR (faixas sem etiqueta não provam nada). `audio`: as faixas como "idioma (nome)", para relatórios.
 */
export type Probe = {
  durationSec?: number;
  ptAudio: boolean;
  noPtAudio: boolean;
  audio: string[];
  fps?: number;
  /** Quanto a faixa PT-BR começa DEPOIS da original do mesmo arquivo (s; negativo = antes). Só MKV DUAL. */
  ptLagSec?: number;
};

/**
 * Dublagem fora do vídeo no próprio arquivo: a faixa PT-BR começa 1 s ou mais ANTES da original. O vídeo
 * vem do mesmo release que a faixa original, então é ela que está no tempo certo; quem juntou a
 * dublagem não aplicou o atraso dela (Loki T1E1, Vinci: inglês em 2,985 s, português em 0). Começar
 * DEPOIS passa: é como se sincroniza uma dublagem sem as vinhetas do início.
 */
export function dubMisaligned(p: Pick<Probe, 'ptLagSec'>): boolean {
  return p.ptLagSec !== undefined && p.ptLagSec <= -DUB_EARLY_SEC;
}
const DUB_EARLY_SEC = 1;

/**
 * Início da faixa PT-BR menos o da original, quando os dois foram lidos. A original é a primeira faixa
 * que não é português, marcada ou não (no Vinci o inglês vem sem etiqueta de idioma).
 */
export function ptLagOf(tracks: { startSec?: number; startAtLeast?: boolean }[], verdicts: TrackVerdict[]): number | undefined {
  const pt = tracks.find((t, i) => verdicts[i] === 'pt-br' && t.startSec !== undefined && !t.startAtLeast);
  const original = tracks.find((t, i) => (verdicts[i] === 'other' || verdicts[i] === 'unknown') && t.startSec !== undefined);
  // A original que nem apareceu no trecho lido começa no mínimo ali: a diferença real é ainda maior
  return pt && original ? pt.startSec! - original.startSec! : undefined;
}

/** Quadros por segundo do primeiro vídeo do arquivo (do DefaultDuration do MKV), quando informado */
export function fpsOf(tracks: { type?: unknown; frameDurationNs?: number }[]): number | undefined {
  const ns = tracks.find(t => t.type === 'video' && t.frameDurationNs)?.frameDurationNs;
  return ns ? 1e9 / ns : undefined;
}

// 23,976 × 24 qps difere 0,1%: abaixo da metade disso é arredondamento do cabeçalho
const MAX_SPEED_DIFF = 0.0005;

/** As duas versões rodam na mesma velocidade? Sem taxa de quadros num dos lados, não dá para dizer: passa. */
export function sameSpeed(a?: number, b?: number): boolean {
  if (!a || !b) return true;
  return Math.abs(a / b - 1) <= MAX_SPEED_DIFF;
}

const fpsLabel = (fps: number) => fps.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');

// A duração de um arquivo não muda: guarda por 7 dias (em memória; some quando a função esfria)
const PROBE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const probeCache = new Map<string, { result: Promise<Probe>; expires: number }>();

/** Resolve o link do CDN (o mesmo que o /play vai entregar) e lê o cabeçalho do arquivo. */
export function probe(c: Candidate, payload: PlayPayload, clientIp?: string): Promise<Probe> {
  // Link direto já lido pelo app: usa a leitura dele (daqui o site recusa a conexão)
  if (c.relayProbe?.durationSec) {
    const audio = c.relayProbe.languages;
    const tagged = audio.filter(l => l && !/^(und|unk|mis|zxx|\?)/i.test(l));
    const ptAudio = audio.length === 0 || tagged.some(l => /^(pt|por)/i.test(l));
    // Faixa sem etiqueta não prova nada: só é "sem PT-BR" quando todas têm idioma e nenhum é PT
    const noPtAudio = !ptAudio && tagged.length === audio.length;
    return Promise.resolve({ durationSec: c.relayProbe.durationSec, ptAudio, noPtAudio, audio });
  }
  const key = playKey(payload);
  const now = Date.now();
  const hit = probeCache.get(key);
  if (hit && hit.expires > now) return hit.result;

  const result = (async () => {
    const { url } = await resolvePlayCached(key, payload, clientIp).result;
    const { tracks, durationSec } = await readTracks(url, c.filename, { withStarts: true });
    const acceptGenericPor = getConfig().ACCEPT_GENERIC_POR;
    const audioTracks = tracks.filter(t => t.type === 'audio');
    const verdicts = audioTracks.map(t => classifyTrack(t, { acceptGenericPor }));
    const ptAudio = verdicts.includes('pt-br');
    const noPtAudio = verdicts.length > 0 && verdicts.every(v => v === 'other' || v === 'pt-pt');
    const audio = audioTracks.map(t => `${t.languageBCP47 ?? t.language ?? '?'}${t.name ? ` (${t.name})` : ''}`);
    return { durationSec, ptAudio, noPtAudio, audio, fps: fpsOf(tracks), ptLagSec: ptLagOf(audioTracks, verdicts) };
  })();
  probeCache.set(key, { result, expires: now + PROBE_CACHE_MS });
  result.catch(() => probeCache.delete(key));
  return result;
}

// --- Busca do par -----------------------------------------------------------------------

export type PairAttempt = {
  video: string;
  audio: string;
  videoSec?: number;
  audioSec?: number;
  diffMs?: number;
  ok: boolean;
  reason?: string;
};

export type PairReport = {
  videos: string[];
  attempts: PairAttempt[];
  chosen?: string;
  timedOut?: boolean;
  ms: number;
};

/** `approximate`: durações batem só dentro da tolerância maior (pode exigir ajuste de atraso no player) */
export type Pair = {
  video: Candidate;
  audio: Candidate;
  diffMs: number;
  approximate: boolean;
  /** os dois arquivos têm um idioma em comum (o app compara o mesmo idioma: sincronia mais segura) */
  sharedLanguage: boolean;
  /** durações conferidas; false = link direto que não deu para abrir daqui (só a sincronia do app) */
  verified: boolean;
  /**
   * Quanto a dublagem precisa andar (ms; positivo = atrasar) para alinhar com a faixa original do próprio
   * arquivo de áudio, pelo início das faixas no arquivo. Exato, ao contrário de medir português contra
   * inglês pelo som (Vinci: +2985). Ausente quando o início das faixas não foi lido.
   */
  dubLagMs?: number;
};

/** Idiomas das faixas de um Probe ("eng (English)" → "en"), sem o português */
function languagesOf(audio: string[]): Set<string> {
  const out = new Set<string>();
  for (const item of audio) {
    const code = item.split(/[ (]/)[0].toLowerCase();
    if (!code || code === '?' || code === 'und') continue;
    const short = code.startsWith('pt') || code === 'por' ? 'pt' : code.slice(0, 2);
    if (short !== 'pt') out.add(short);
  }
  return out;
}

// Nunca a URL: links de "resolve" (Torrentio etc.) levam a chave do TorBox no caminho
const label = (c: Candidate) => c.filename ?? `${c.urlSource}: item sem nome de arquivo`;
const errorText = (err: unknown) => (err instanceof Error ? err.message : 'erro');

/**
 * Procura o par para os melhores 4K sem dublagem, na ordem de qualidade. Respeita um tempo máximo: se estourar, a lista
 * sai sem o par e as leituras seguem em segundo plano, preenchendo o cache para a próxima vez.
 *
 * @param videos 4K sem dublagem, já ordenados por qualidade
 * @param dubbed versões dubladas, já ordenadas por qualidade
 */
export async function findPair(
  videos: Candidate[],
  dubbed: Candidate[],
  payloadOf: (c: Candidate) => PlayPayload,
  clientIp?: string,
  /** tempo máximo; padrão PAIR_BUDGET_MS */
  budgetMs?: number,
): Promise<{ pair: Pair | null; report: PairReport }> {
  const started = Date.now();
  const { PAIR_MAX_DIFF_MS, PAIR_APPROX_DIFF_MS, PAIR_MAX_ATTEMPTS, PAIR_MAX_VIDEOS, PAIR_BUDGET_MS } = getConfig();
  // Par aproximado mais próximo, usado só se nenhum vídeo tiver par exato
  let approximate: Pair | null = null;
  // Melhor par exato sem idioma em comum (vale se nenhum outro tiver) e link direto não conferido
  let exactWithoutShared: Pair | null = null;
  // Par exato com a dublagem adiantada no próprio arquivo (Vinci): o app mede e corrige um atraso fixo,
  // mas só vale se nenhuma dublagem alinhada combinar
  let exactMisaligned: Pair | null = null;
  let unverified: Pair | null = null;
  // Sem nenhuma faixa marcada como PT-BR: o melhor dublado (pelo nome ou pela fonte) cuja faixa
  // vem sem etiqueta de idioma (Velozes e Furiosos: três dublados a 1,1 s do 4K, todos "und")
  let untagged: Pair | null = null;
  // Releases 4K do mesmo filme variam de duração (créditos e logos de distribuidoras de outros
  // países): testa alguns, já que a duração das versões dubladas fica no cache depois do primeiro
  const pool = pairVideoPool(videos.filter(v => v.kind === 'debrid'), dubbed, PAIR_MAX_VIDEOS);
  const report: PairReport = { videos: pool.map(label), attempts: [], ms: 0 };
  if (!pool.length || !audioPartners(pool[0], dubbed).length) {
    return { pair: null, report: { ...report, ms: Date.now() - started } };
  }

  const search = (async (): Promise<Pair | null> => {
    // Cabeçalhos dos vídeos e dos parceiros em paralelo: a velocidade de todos decide a ordem
    const videoProbes = new Map(pool.map(v => [v, probe(v, payloadOf(v), clientIp)] as const));
    const partners = audioPartners(pool[0], dubbed).slice(0, PAIR_MAX_ATTEMPTS);
    const partnerProbes = partners.map(a => probe(a, payloadOf(a), clientIp));
    [...videoProbes.values(), ...partnerProbes].forEach(p => p.catch(() => {}));

    // Um prazo curto para as velocidades: uma leitura lenta (torrent que precisa voltar para a conta) não
    // segura as outras; o que não chegou conta como desconhecido e fica na fila, depois dos que combinam
    const settled = <T,>(p: Promise<T>) => Promise.race([p.catch(() => undefined), delay(SPEED_WAIT_MS)]);
    const fpsOfVideo = new Map<Candidate, number | undefined>();
    await Promise.all(pool.map(async v => fpsOfVideo.set(v, (await settled(videoProbes.get(v)!))?.fps)));
    const dubFps = await Promise.all(partnerProbes.map(async p => {
      const r = await settled(p);
      return r?.ptAudio ? r.fps : undefined;
    }));
    const ordered = orderBySpeed(pool, v => fpsOfVideo.get(v), dubFps, mp4Penalty);
    for (const video of pool.filter(v => !ordered.includes(v))) {
      report.attempts.push({ video: label(video), audio: '-', ok: false, reason: 'nenhuma dublagem na mesma velocidade' });
    }

    for (const video of ordered) {
      const found = await tryVideo(video, videoProbes.get(video)!);
      if (found) return found;
    }
    // Uma dublagem alinhada com idioma em comum vem antes da dublagem fora do vídeo: o app compara o
    // original dos dois arquivos e corrige o atraso fixo com precisão (Loki: 22 ms medidos, r=0,92), mas
    // não consegue medir a dublagem contra o próprio original (r=0,08) e o português saía ~3 s adiantado
    const approxShared = (approximate as Pair | null)?.sharedLanguage ? approximate : null;
    return exactWithoutShared ?? approxShared ?? exactMisaligned ?? approximate ?? untagged ?? unverified;
  })();

  async function tryVideo(video: Candidate, videoProbe: Promise<Probe>): Promise<Pair | null> {
    let videoSec: number | undefined;
    let videoFps: number | undefined;
    let videoLanguages = new Set<string>();
    try {
      const probed = await videoProbe;
      videoSec = probed.durationSec;
      videoFps = probed.fps;
      videoLanguages = languagesOf(probed.audio);
    } catch (err) {
      report.attempts.push({ video: label(video), audio: '-', ok: false, reason: `vídeo: ${errorText(err)}` });
      return null;
    }
    if (!videoSec) {
      report.attempts.push({ video: label(video), audio: '-', ok: false, reason: 'vídeo sem duração no cabeçalho' });
      return null;
    }

    for (const audio of audioPartners(video, dubbed).slice(0, PAIR_MAX_ATTEMPTS)) {
      const attempt: PairAttempt = { video: label(video), audio: label(audio), videoSec, ok: false };
      report.attempts.push(attempt);
      try {
        const probed = await probe(audio, payloadOf(audio), clientIp);
        const { durationSec, ptAudio } = probed;
        const dubLagMs = probed.ptLagSec === undefined ? undefined : Math.round(-probed.ptLagSec * 1000);
        const sharedLanguage = [...languagesOf(probed.audio)].some(l => videoLanguages.has(l));
        attempt.audioSec = durationSec;
        if (!ptAudio && probed.noPtAudio) { attempt.reason = 'arquivo sem faixa PT-BR'; continue; }
        if (!durationSec) { attempt.reason = 'sem duração no cabeçalho'; continue; }
        // Velocidades diferentes: nenhum atraso fixo sincroniza (o áudio escorrega ao longo do filme)
        if (!sameSpeed(videoFps, probed.fps)) {
          attempt.reason = `velocidades diferentes (${fpsLabel(videoFps!)} × ${fpsLabel(probed.fps!)} qps)`;
          continue;
        }
        const diffMs = Math.round(Math.abs(durationSec - videoSec) * 1000);
        attempt.diffMs = diffMs;
        if (!ptAudio) {
          // Faixa sem etiqueta num arquivo dublado pelo nome/fonte: reserva, atrás de qualquer PT-BR marcado
          if (diffMs <= PAIR_APPROX_DIFF_MS) {
            attempt.reason = 'faixa sem etiqueta de idioma (reserva)';
            const approx = diffMs > PAIR_MAX_DIFF_MS;
            const better = !untagged || (untagged.approximate && !approx) ||
              (untagged.approximate === approx && diffMs < untagged.diffMs);
            if (better) untagged = { video, audio, diffMs, approximate: approx, sharedLanguage: false, verified: true, dubLagMs };
          } else {
            attempt.reason = 'durações diferentes';
          }
          continue;
        }
        if (diffMs <= PAIR_MAX_DIFF_MS) {
          const pair = { video, audio, diffMs, approximate: false, sharedLanguage, verified: true, dubLagMs };
          if (dubMisaligned(probed)) {
            attempt.reason = 'exato, mas com a dublagem fora do vídeo no arquivo (reserva)';
            if (!exactMisaligned) exactMisaligned = pair;
            continue;
          }
          if (sharedLanguage) {
            attempt.ok = true;
            return pair;
          }
          // Exato, mas sem idioma em comum (dublagem só em português): segue procurando um "Dual"
          attempt.reason = 'exato, sem idioma em comum';
          if (!exactWithoutShared) exactWithoutShared = pair;
          continue;
        }
        if (diffMs <= PAIR_APPROX_DIFF_MS) {
          attempt.reason = 'aproximado';
          if (!approximate || diffMs < approximate.diffMs) {
            approximate = { video, audio, diffMs, approximate: true, sharedLanguage, verified: true, dubLagMs };
          }
          continue;
        }
        attempt.reason = 'durações diferentes';
      } catch (err) {
        attempt.reason = errorText(err);
        // Link direto que daqui não abre (o site recusa a Vercel): só a sincronia do app confere
        if (audio.kind === 'http' && !unverified) {
          unverified = { video, audio, diffMs: 0, approximate: true, sharedLanguage: false, verified: false };
        }
      }
    }
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), budgetMs ?? PAIR_BUDGET_MS); });
  const outcome = await Promise.race([search, timeout]);
  clearTimeout(timer);

  if (outcome === 'timeout') {
    search.catch(() => {});
    return { pair: null, report: { ...report, timedOut: true, ms: Date.now() - started } };
  }
  if (outcome) report.chosen = label(outcome.audio);
  return { pair: outcome, report: { ...report, ms: Date.now() - started } };
}
