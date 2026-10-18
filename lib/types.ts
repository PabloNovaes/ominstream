/**
 * Modelo central: cada stream de cada fonte vira um Candidate padronizado,
 * independente do formato em que o addon de origem respondeu.
 */

export type Resolution = 2160 | 1440 | 1080 | 720 | 576 | 480 | null;
export type Hdr = 'DV' | 'HDR10+' | 'HDR10' | 'HDR' | 'HLG';

/**
 * - debrid: link de "resolve" de um addon ligado ao TorBox (o torrent só é adicionado no play)
 * - http:   link direto para um arquivo de vídeo
 * - hls:    playlist de vídeo segmentado (.m3u8)
 */
export type CandidateKind = 'debrid' | 'http' | 'hls';

export type Candidate = {
  kind: CandidateKind;
  url: string;
  /** fonte que gerou o `url` (após a deduplicação, o link mantido é o de uma das fontes) */
  urlSource: string;
  infoHash?: string;
  fileIdx?: number;

  /** addons que retornaram este mesmo item (após deduplicação) */
  sources: string[];
  /** maior peso entre as fontes que trouxeram o item */
  sourceWeight: number;

  filename?: string;
  /** texto completo exibido pelo addon de origem (título + descrição), usado para indícios */
  rawText: string;

  resolution: Resolution;
  hdr: Hdr[];
  remux: boolean;
  codec?: 'av1' | 'hevc' | 'avc';
  sizeBytes?: number;
  releaseGroup?: string;
  /** o addon de origem indicou que o torrent está no cache do TorBox */
  cachedHint: boolean;
  /** confirmado pelo checkcached do TorBox */
  cached?: boolean;

  /** indícios de áudio em PT-BR no texto (0–100) e o motivo de cada ponto */
  audio?: { score: number; signals: string[] };
  /** true: a faixa PT-BR foi conferida no próprio arquivo (não só no nome) */
  audioVerified?: boolean;

  /** behaviorHints do stream original que precisam ser repassados (ex.: proxyHeaders) */
  passthroughHints?: Record<string, unknown>;
};
