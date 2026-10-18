import { getConfig } from './config';
import { playKey, resolvePlayCached, type PlayPayload } from './play';
import type { Candidate } from './types';
import { classifyTrack, isAmbiguousPortuguese } from './verify/language';
import { readTracks } from './verify/tracks';

/**
 * "4K + áudio PT-BR": quando não há 4K dublado, junta o vídeo de um 4K sem dublagem com o
 * áudio de uma versão dublada (o app toca os dois juntos via behaviorHints.audioUrl).
 *
 * O par só é oferecido se as DURAÇÕES baterem: é o que garante que as duas versões têm o
 * mesmo corte e a mesma velocidade (dublagem PAL a 25 fps fica ~4% mais curta; versão
 * estendida, mais longa). Vinhetas diferentes com a mesma duração total passam: o ajuste
 * de atraso do player cobre esse caso.
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
  const compatible = dubbed.filter(c => c.kind === 'debrid' && editionOf(textOf(c)) === edition);
  // Só "Portuguese" sem sinal de Brasil pode ser a dublagem de Portugal: fica por último
  const rank = (c: Candidate) =>
    (isAmbiguousPortuguese(textOf(c)) ? 4 : 0) + (c.filename ? 0 : 2) + (originOf(textOf(c)) === origin ? 0 : 1);
  return compatible
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

// --- Leitura do arquivo (duração e faixas) ---------------------------------------------

/**
 * `ptAudio`: tem faixa PT-BR confirmada. `noPtAudio`: todas as faixas têm idioma marcado e nenhum é
 * PT-BR (faixas sem etiqueta não provam nada). `audio`: as faixas como "idioma (nome)", para relatórios.
 */
export type Probe = { durationSec?: number; ptAudio: boolean; noPtAudio: boolean; audio: string[] };

// A duração de um arquivo não muda: guarda por 7 dias (em memória; some quando a função esfria)
const PROBE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const probeCache = new Map<string, { result: Promise<Probe>; expires: number }>();

/** Resolve o link do CDN (o mesmo que o /play vai entregar) e lê o cabeçalho do arquivo. */
export function probe(c: Candidate, payload: PlayPayload, clientIp?: string): Promise<Probe> {
  const key = playKey(payload);
  const now = Date.now();
  const hit = probeCache.get(key);
  if (hit && hit.expires > now) return hit.result;

  const result = (async () => {
    const { url } = await resolvePlayCached(key, payload, clientIp).result;
    const { tracks, durationSec } = await readTracks(url, c.filename);
    const acceptGenericPor = getConfig().ACCEPT_GENERIC_POR;
    const audioTracks = tracks.filter(t => t.type === 'audio');
    const verdicts = audioTracks.map(t => classifyTrack(t, { acceptGenericPor }));
    const ptAudio = verdicts.includes('pt-br');
    const noPtAudio = verdicts.length > 0 && verdicts.every(v => v === 'other' || v === 'pt-pt');
    const audio = audioTracks.map(t => `${t.languageBCP47 ?? t.language ?? '?'}${t.name ? ` (${t.name})` : ''}`);
    return { durationSec, ptAudio, noPtAudio, audio };
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
export type Pair = { video: Candidate; audio: Candidate; diffMs: number; approximate: boolean };

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
): Promise<{ pair: Pair | null; report: PairReport }> {
  const started = Date.now();
  const { PAIR_MAX_DIFF_MS, PAIR_APPROX_DIFF_MS, PAIR_MAX_ATTEMPTS, PAIR_MAX_VIDEOS, PAIR_BUDGET_MS } = getConfig();
  // Par aproximado mais próximo, usado só se nenhum vídeo tiver par exato
  let approximate: Pair | null = null;
  // Releases 4K do mesmo filme variam de duração (créditos e logos de distribuidoras de outros
  // países): testa alguns, já que a duração das versões dubladas fica no cache depois do primeiro
  const candidates = videos.filter(v => v.kind === 'debrid').slice(0, PAIR_MAX_VIDEOS);
  const report: PairReport = { videos: candidates.map(label), attempts: [], ms: 0 };
  if (!candidates.length || !audioPartners(candidates[0], dubbed).length) {
    return { pair: null, report: { ...report, ms: Date.now() - started } };
  }

  const search = (async (): Promise<Pair | null> => {
    // Cabeçalhos dos vídeos e do primeiro parceiro em paralelo
    const videoProbes = candidates.map(v => probe(v, payloadOf(v), clientIp));
    videoProbes.forEach(p => p.catch(() => {}));
    const firstPartner = audioPartners(candidates[0], dubbed)[0];
    void probe(firstPartner, payloadOf(firstPartner), clientIp).catch(() => {});

    for (const [index, video] of candidates.entries()) {
      const found = await tryVideo(video, videoProbes[index]);
      if (found) return found;
    }
    return approximate;
  })();

  async function tryVideo(video: Candidate, videoProbe: Promise<Probe>): Promise<Pair | null> {
    let videoSec: number | undefined;
    try {
      videoSec = (await videoProbe).durationSec;
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
        const { durationSec, ptAudio } = await probe(audio, payloadOf(audio), clientIp);
        attempt.audioSec = durationSec;
        if (!ptAudio) { attempt.reason = 'arquivo sem faixa PT-BR'; continue; }
        if (!durationSec) { attempt.reason = 'sem duração no cabeçalho'; continue; }
        const diffMs = Math.round(Math.abs(durationSec - videoSec) * 1000);
        attempt.diffMs = diffMs;
        if (diffMs <= PAIR_MAX_DIFF_MS) {
          attempt.ok = true;
          return { video, audio, diffMs, approximate: false };
        }
        if (diffMs <= PAIR_APPROX_DIFF_MS) {
          attempt.reason = 'aproximado';
          if (!approximate || diffMs < approximate.diffMs) approximate = { video, audio, diffMs, approximate: true };
          continue;
        }
        attempt.reason = 'durações diferentes';
      } catch (err) {
        attempt.reason = errorText(err);
      }
    }
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), PAIR_BUDGET_MS); });
  const outcome = await Promise.race([search, timeout]);
  clearTimeout(timer);

  if (outcome === 'timeout') {
    search.catch(() => {});
    return { pair: null, report: { ...report, timedOut: true, ms: Date.now() - started } };
  }
  if (outcome) report.chosen = label(outcome.audio);
  return { pair: outcome, report: { ...report, ms: Date.now() - started } };
}
