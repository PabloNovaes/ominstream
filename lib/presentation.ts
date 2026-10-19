import type { Pair } from './pair';
import { isImax, isTenBit, parseAudioBadges, parseSource } from './release';
import type { Candidate } from './types';

/**
 * Dados estruturados de cada opção para a tela de reprodução do fork do Nuvio TV
 * (`behaviorHints.ominstream`): o app monta os selos e o texto a partir daqui em vez de ler
 * emojis do `name`/`description`. Outros players ignoram o campo e mostram o texto de sempre.
 */
export type OminInfo = {
  v: 1;
  /** "4K", "1440p", "1080p", "720p", "SD" ou null quando a fonte não diz */
  resolution: string | null;
  /** selos de imagem, na ordem de exibição: HDR, IMAX, origem, 10-BIT */
  video: string[];
  /** selos do áudio que vai tocar (no par, o da versão dublada) */
  audio: string[];
  /** pt-br: dublado declarado · dual: português + original · likely: indícios de português */
  language: 'pt-br' | 'dual' | 'likely';
  /** áudio vindo de outro arquivo, sincronizado pelo app */
  synced: boolean;
  /** cached: no TorBox, toca na hora · direct: link direto · hls: transmissão segmentada */
  ready: 'cached' | 'direct' | 'hls';
  /** a primeira opção da lista */
  recommended: boolean;
  /** frase para o painel "Sobre esta opção" */
  summary: string;
  /** detalhes técnicos curtos, exibidos abaixo da frase */
  details: string[];
};

const RESOLUTION: Record<number, string> = { 2160: '4K', 1440: '1440p', 1080: '1080p', 720: '720p', 576: 'SD', 480: 'SD' };
const RESOLUTION_WORDS: Record<string, string> = { '4K': '4K', '1440p': '1440p', '1080p': 'Full HD', '720p': 'HD', SD: 'SD' };

const textOf = (c: Candidate) => `${c.filename ?? ''}\n${c.rawText}`;

function videoBadges(c: Candidate): string[] {
  const text = textOf(c);
  const badges: string[] = [];
  if (c.hdr.includes('DV')) badges.push('DOLBY VISION');
  if (c.hdr.includes('HDR10+')) badges.push('HDR10+');
  else if (c.hdr.includes('HDR10') || c.hdr.includes('HDR')) badges.push('HDR10');
  if (c.hdr.includes('HLG')) badges.push('HLG');
  if (isImax(text)) badges.push('IMAX');
  const source = c.remux ? 'REMUX' : parseSource(text);
  if (source) badges.push(source);
  return badges;
}

function languageOf(c: Candidate): OminInfo['language'] {
  if (c.audioVerified || (c.audio?.score ?? 0) >= 70) return /\bdual\b/i.test(textOf(c)) ? 'dual' : 'pt-br';
  return /\bdual\b/i.test(textOf(c)) ? 'dual' : 'likely';
}

const readyOf = (c: Candidate): OminInfo['ready'] => (c.kind === 'debrid' ? 'cached' : c.kind === 'hls' ? 'hls' : 'direct');

function sizeLabel(bytes?: number): string | undefined {
  if (!bytes) return undefined;
  const gb = bytes / 2 ** 30;
  return gb >= 1 ? `${gb.toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / 2 ** 20)} MB`;
}

function codecLabel(c: Candidate): string | undefined {
  const codec = c.codec === 'hevc' ? 'HEVC' : c.codec === 'av1' ? 'AV1' : c.codec === 'avc' ? 'H.264' : undefined;
  if (!codec) return undefined;
  return isTenBit(textOf(c)) ? `${codec} 10-bit` : codec;
}

/** "Remux do Blu-ray", "Streaming (WEB)"... — de onde veio a imagem, em palavras */
function sourceWords(c: Candidate): string | undefined {
  switch (c.remux ? 'REMUX' : parseSource(textOf(c))) {
    case 'REMUX': return 'Imagem do Blu-ray, sem recompressão';
    case 'BLU-RAY': return 'Cópia do Blu-ray';
    case 'WEB-DL': return 'Versão de streaming';
    case 'WEBRIP': return 'Gravação de streaming';
    case 'HDTV': return 'Gravação de TV';
    default: return undefined;
  }
}

function hdrWords(c: Candidate): string | undefined {
  if (c.hdr.includes('DV')) return 'Dolby Vision';
  if (c.hdr.includes('HDR10+')) return 'HDR10+';
  if (c.hdr.length) return 'HDR';
  return undefined;
}

function imageSentence(c: Candidate, resolution: string | null): string {
  const source = sourceWords(c);
  const res = resolution ? RESOLUTION_WORDS[resolution] : undefined;
  const hdr = hdrWords(c);
  const head = source ? `${source}${res ? ` em ${res}` : ''}` : res ? `Vídeo em ${res}` : 'Vídeo';
  return `${head}${hdr ? `, com ${hdr}` : ''}.`;
}

const LANGUAGE_SENTENCE: Record<OminInfo['language'], string> = {
  'pt-br': 'Áudio dublado em português.',
  dual: 'Áudio em português e no idioma original.',
  likely: 'Os indícios apontam áudio em português.',
};

/** A faixa em português foi conferida no próprio arquivo */
const VERIFIED_SENTENCE: Record<OminInfo['language'], string> = {
  'pt-br': 'Áudio em português conferido no arquivo.',
  dual: 'Áudio em português (conferido no arquivo) e no idioma original.',
  likely: 'Áudio em português conferido no arquivo.',
};

const READY_SENTENCE: Record<OminInfo['ready'], string> = {
  cached: 'Pronto para tocar.',
  direct: 'Link direto da fonte.',
  hls: 'Transmissão direta da fonte.',
};

/** Bloco estruturado de uma opção comum (o vídeo e o áudio vêm do mesmo arquivo). */
export function candidateInfo(c: Candidate, recommended: boolean): OminInfo {
  const resolution = c.resolution ? RESOLUTION[c.resolution] : null;
  const language = languageOf(c);
  const ready = readyOf(c);
  return {
    v: 1,
    resolution,
    video: videoBadges(c),
    audio: parseAudioBadges(textOf(c)),
    language,
    synced: false,
    ready,
    recommended,
    summary: [
      imageSentence(c, resolution),
      c.audioVerified ? VERIFIED_SENTENCE[language] : LANGUAGE_SENTENCE[language],
      READY_SENTENCE[ready],
    ].join(' '),
    details: [codecLabel(c), sizeLabel(c.sizeBytes), c.releaseGroup ? `Grupo ${c.releaseGroup.toUpperCase()}` : undefined]
      .filter((d): d is string => Boolean(d)),
  };
}

/** Bloco do par 4K + áudio PT-BR: imagem de um arquivo, áudio dublado de outro. */
export function pairInfo({ video, audio, diffMs, sharedLanguage, verified, approximate }: Pair, recommended: boolean): OminInfo {
  const resolution = video.resolution ? RESOLUTION[video.resolution] : null;
  const seconds = (diffMs / 1000).toFixed(1).replace('.', ',');
  return {
    v: 1,
    resolution,
    video: videoBadges(video),
    audio: parseAudioBadges(textOf(audio)),
    language: 'pt-br',
    // "Sincronizado" só quando dá para garantir: durações batem e há um idioma para comparar
    synced: verified && !approximate && sharedLanguage,
    ready: 'cached',
    recommended,
    summary: `${imageSentence(video, resolution)} ${pairSyncSentence(sharedLanguage, verified, approximate)}`,
    details: [
      codecLabel(video),
      video.releaseGroup ? `${video.remux ? 'Remux' : 'Vídeo'} · ${video.releaseGroup.toUpperCase()}` : undefined,
      verified
        ? `Áudio: ${audio.releaseGroup?.toUpperCase() ?? 'versão dublada'} (dif. ${seconds} s)`
        : `Áudio: ${audio.releaseGroup?.toUpperCase() ?? 'link direto'} (duração não conferida)`,
    ].filter((d): d is string => Boolean(d)),
  };
}

function pairSyncSentence(sharedLanguage: boolean, verified: boolean, approximate: boolean): string {
  if (!verified) return 'O áudio dublado vem de um link direto; o player sincroniza pelo som e pode pedir ajuste.';
  if (approximate) return 'O áudio dublado vem de outra versão, com duração um pouco diferente; pode precisar de ajuste.';
  if (sharedLanguage) return 'O áudio dublado vem de outra versão e é sincronizado automaticamente.';
  return 'O áudio dublado vem de outra versão; o player sincroniza pela trilha sonora.';
}
