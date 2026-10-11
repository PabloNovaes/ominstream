import { parseCodec, parseHdr, parseReleaseGroup, parseRemux, parseResolution, parseSize } from '../release';
import type { Candidate, CandidateKind } from '../types';
import { stripLanguageHints } from '../verify/language';
import type { RawStream, SourceResult } from './fetch';

const HASH_RE = /(?:^|[/|])([a-f0-9]{40})(?=$|[/|?])/i;
// Entradas que não são vídeo: pedidos de doação, convites para Discord etc.
const NOISE_RE = /donat|discord|support the project|join the/i;
// Links só para download (não tocam no player)
const DOWNLOAD_ONLY_RE = /download only/i;
const DOWNLOAD_ONLY_URL_RE = /\/tb\/download\b/;
// Indicação, pelo próprio addon, de que o torrent já está no cache do TorBox
const CACHED_RE = /\[TB\+\]|TB⚡|⚡/;
// Hints repassados ao player sem alteração (ex.: cabeçalhos exigidos pelo servidor de vídeo)
const PASSTHROUGH_HINTS = ['proxyHeaders', 'notWebReady'];

/** infoHash de onde cada addon o coloca: caminho da URL (Torrentio, Magneto, MediaFusion) ou bingeGroup (Comet). */
function extractInfoHash(stream: RawStream): string | undefined {
  if (stream.infoHash) return stream.infoHash.toLowerCase();
  const fromHint = stream.behaviorHints?.bingeGroup?.match(HASH_RE)?.[1];
  if (fromHint) return fromHint.toLowerCase();
  try {
    return new URL(stream.url!).pathname.match(HASH_RE)?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Índice do arquivo no torrent (Torrentio: /resolve/torbox/<config>/<hash>/<token>/<fileIdx>/<nome>). */
function extractFileIdx(stream: RawStream, infoHash?: string): number | undefined {
  if (typeof stream.fileIdx === 'number') return stream.fileIdx;
  if (!infoHash || !stream.url) return undefined;
  try {
    const segs = new URL(stream.url).pathname.split('/');
    const at = segs.findIndex(s => s.toLowerCase() === infoHash);
    const idx = segs.slice(at + 1).find(s => /^\d{1,4}$/.test(s));
    return idx !== undefined ? Number(idx) : undefined;
  } catch {
    return undefined;
  }
}

/** Nome do arquivo: behaviorHints.filename ou a primeira linha que pareça nome de arquivo/release. */
function extractFilename(stream: RawStream, text: string): string | undefined {
  const hinted = stream.behaviorHints?.filename?.split('|^|')[0]; // PenguPlay concatena metadados com "|^|"
  if (hinted) return hinted;
  const lines = text
    .split('\n')
    // Remove ícones e rótulos entre colchetes no início ("[FSL] [💾 9.45 GB] Nome.mkv", "📄 Nome.mkv")
    .map(l => l.replace(/^(?:[^\p{L}\p{N}[]*\[[^\]]*\])*[^\p{L}\p{N}]*/u, '').trim());
  const line =
    lines.find(l => /\.(mkv|mp4|avi|m4v)$/i.test(l)) ??
    lines.find(l => /[._ ](2160p|1080p|720p|480p)[._ ]/i.test(l) && /[.]|\s/.test(l) && l.length > 15);
  return line || undefined;
}

function kindOf(url: string, infoHash?: string): CandidateKind {
  if (infoHash) return 'debrid';
  if (/\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url)) return 'hls';
  return 'http';
}

export function normalize(results: SourceResult[]): Candidate[] {
  const out: Candidate[] = [];
  for (const { source, streams } of results) {
    for (const stream of streams) {
      if (!stream.url) continue; // externalUrl (abre no navegador) ou entradas sem vídeo
      let rawText = [stream.name, stream.title, stream.description].filter(Boolean).join('\n');
      if (!source.trustLanguageTags) rawText = stripLanguageHints(rawText);
      if (NOISE_RE.test(rawText) && !/\b(2160p|1080p|720p|4k)\b/i.test(rawText)) continue;
      if (DOWNLOAD_ONLY_RE.test(rawText) || DOWNLOAD_ONLY_URL_RE.test(stream.url)) continue;

      const infoHash = extractInfoHash(stream);
      const filename = extractFilename(stream, rawText);
      // O nome do arquivo é a fonte mais confiável; o texto do addon só completa o que faltar
      const pick = <T>(parse: (t: string) => T, empty: (v: T) => boolean) => {
        const fromFile = filename ? parse(filename) : undefined;
        return fromFile !== undefined && !empty(fromFile) ? fromFile : parse(rawText);
      };
      const hints = stream.behaviorHints ?? {};

      out.push({
        kind: kindOf(stream.url, infoHash),
        url: stream.url,
        urlSource: source.name,
        infoHash,
        fileIdx: extractFileIdx(stream, infoHash),
        sources: [source.name],
        sourceWeight: source.weight,
        filename,
        rawText,
        resolution: pick(parseResolution, v => v === null),
        hdr: pick(parseHdr, v => v.length === 0),
        remux: pick(parseRemux, v => !v),
        codec: pick(parseCodec, v => v === undefined),
        sizeBytes: typeof hints.videoSize === 'number' ? hints.videoSize : parseSize(rawText),
        releaseGroup: parseReleaseGroup(filename),
        cachedHint: CACHED_RE.test(stream.name ?? ''),
        passthroughHints: Object.fromEntries(PASSTHROUGH_HINTS.filter(k => k in hints).map(k => [k, hints[k]])),
      });
    }
  }
  return out;
}

const fileKey = (c: Candidate) =>
  c.filename ? `f:${c.filename.toLowerCase().replace(/[\s._-]+/g, '.')}:${c.sizeBytes ? Math.round(c.sizeBytes / 2 ** 27) : ''}` : null;

/**
 * Junta o mesmo conteúdo vindo de fontes diferentes, em duas passadas:
 * 1) mesmo infoHash + arquivo (o mesmo torrent em vários addons);
 * 2) mesmo nome de arquivo + tamanho (~128 MB de tolerância): torrents diferentes com o
 *    mesmo release, que os addons de debrid entregam como itens separados.
 * Fica a versão com mais informação; as fontes são somadas.
 */
export function dedupe(candidates: Candidate[]): Candidate[] {
  const byHash = mergeBy(candidates, c => (c.infoHash ? `h:${c.infoHash}:${c.fileIdx ?? ''}` : null));
  return mergeBy(byHash, fileKey);
}

function mergeBy(candidates: Candidate[], keyOf: (c: Candidate) => string | null): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = keyOf(c) ?? `u:${c.url}`;

    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    const richer = c.rawText.length > prev.rawText.length ? c : prev;
    byKey.set(key, {
      ...richer,
      sources: [...new Set([...prev.sources, ...c.sources])],
      sourceWeight: Math.max(prev.sourceWeight, c.sourceWeight),
      rawText: `${prev.rawText}\n${c.rawText}`, // indícios de todas as fontes ficam disponíveis
      cachedHint: prev.cachedHint || c.cachedHint,
      sizeBytes: prev.sizeBytes ?? c.sizeBytes,
      fileIdx: prev.fileIdx ?? c.fileIdx,
    });
  }
  return [...byKey.values()];
}
