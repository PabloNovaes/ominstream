import type { Candidate } from '../types';

/**
 * Ordem de qualidade: resolução > Dolby Vision/HDR > remux > codec > tamanho.
 * Desempate pela fonte mais confiável e por quantas fontes trouxeram o item.
 */

const hdrScore = (c: Candidate) =>
  (c.hdr.includes('DV') ? 4 : 0) + (c.hdr.includes('HDR10+') ? 3 : c.hdr.includes('HDR10') || c.hdr.includes('HDR') ? 2 : 0);

const codecScore = (c: Candidate) => ({ av1: 3, hevc: 2, avc: 1 })[c.codec ?? 'avc'] ?? 0;

export function compareQuality(a: Candidate, b: Candidate): number {
  return (
    (b.resolution ?? 0) - (a.resolution ?? 0) ||
    hdrScore(b) - hdrScore(a) ||
    Number(b.remux) - Number(a.remux) ||
    codecScore(b) - codecScore(a) ||
    (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) ||
    b.sourceWeight - a.sourceWeight ||
    b.sources.length - a.sources.length
  );
}

export const sortByQuality = (list: Candidate[]) => [...list].sort(compareQuality);

/**
 * Ordem para o vídeo do par 4K + áudio PT-BR: o áudio vem de outro arquivo, então só a imagem conta.
 * Remux (imagem do disco, sem recompressão) vale mais que HDR10+ num encode: resolução > Dolby Vision >
 * remux > HDR10+/HDR10 > codec > tamanho.
 */
export function compareVideoFidelity(a: Candidate, b: Candidate): number {
  const dv = (c: Candidate) => (c.hdr.includes('DV') ? 1 : 0);
  return (
    (b.resolution ?? 0) - (a.resolution ?? 0) ||
    dv(b) - dv(a) ||
    Number(b.remux) - Number(a.remux) ||
    hdrScore(b) - hdrScore(a) ||
    codecScore(b) - codecScore(a) ||
    (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) ||
    b.sourceWeight - a.sourceWeight ||
    b.sources.length - a.sources.length
  );
}

export const sortByVideoFidelity = (list: Candidate[]) => [...list].sort(compareVideoFidelity);

/**
 * Monta a lista final com vagas por resolução (ex.: 3 em 4K, 3 em 1080p, 1 em 720p),
 * para o Full HD não sumir quando existe 4K. 1440p conta como 4K; 576p/480p e resolução
 * desconhecida (comum em fontes HLS brasileiras) entram na vaga de 720p.
 */
export function pickByResolution(sorted: Candidate[], quotas: Map<number, number>): Candidate[] {
  const bucketOf = (c: Candidate) =>
    c.resolution !== null && c.resolution >= 1440 ? 2160 : c.resolution !== null && c.resolution >= 1080 ? 1080 : 720;
  const used = new Map<number, number>();
  return sorted.filter(c => {
    const bucket = bucketOf(c);
    const limit = quotas.get(bucket) ?? 0;
    const count = used.get(bucket) ?? 0;
    if (count >= limit) return false;
    used.set(bucket, count + 1);
    return true;
  });
}
