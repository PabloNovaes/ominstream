import type { Hdr, Resolution } from './types';

/**
 * Extrai características técnicas do nome do release e do texto exibido pelos addons.
 * Os padrões cobrem as variações vistas nas fontes reais (Torrentio, Comet, MediaFusion,
 * Magneto, FrostStream, PenguPlay, FenixFlix, HdHub).
 */

export function parseResolution(text: string): Resolution {
  const t = text.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(t)) return 2160;
  if (/\b1440p\b/.test(t)) return 1440;
  if (/\b(1080p|full ?hd|fhd)\b/.test(t)) return 1080;
  if (/\b720p\b/.test(t)) return 720;
  if (/\b576p\b/.test(t)) return 576;
  if (/\b(480p|sd)\b/.test(t)) return 480;
  return null;
}

export function parseHdr(text: string): Hdr[] {
  const t = text.toLowerCase();
  const out: Hdr[] = [];
  if (/\b(dv|dovi|dolby[ .]?vision)\b/.test(t)) out.push('DV');
  if (/hdr10(\+|plus|p\b)/.test(t)) out.push('HDR10+');
  else if (/\bhdr10\b/.test(t)) out.push('HDR10');
  else if (/\bhdr\b/.test(t)) out.push('HDR');
  if (/\bhlg\b/.test(t)) out.push('HLG');
  return out;
}

export const parseRemux = (text: string) => /\bremux\b/i.test(text);

export function parseCodec(text: string): 'av1' | 'hevc' | 'avc' | undefined {
  const t = text.toLowerCase();
  if (/\bav1\b/.test(t)) return 'av1';
  if (/\b(hevc|[xh][ .]?265)\b/.test(t)) return 'hevc';
  if (/\b(avc|[xh][ .]?264)\b/.test(t)) return 'avc';
  return undefined;
}

/** Tamanho exibido no texto: "💾 8.57 GB", "📦 65.17 GB", "💾 950 MB". Os addons exibem em base 1024. */
export function parseSize(text: string): number | undefined {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i);
  if (!m) return undefined;
  const value = Number(m[1].replace(',', '.'));
  const unit = { TB: 2 ** 40, GB: 2 ** 30, MB: 2 ** 20 }[m[2].toUpperCase() as 'TB' | 'GB' | 'MB'];
  return Math.round(value * unit);
}

/** Grupo de release: o sufixo "-GRUPO" no fim do nome do arquivo (ex.: "...H.265-FLUX.mkv" → "flux"). */
export function parseReleaseGroup(filename?: string): string | undefined {
  if (!filename) return undefined;
  const base = filename.replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '').replace(/\[[^\]]*\]$/, '').trim();
  const m = base.match(/-([A-Za-z0-9]{2,20})$/);
  return m ? m[1].toLowerCase() : undefined;
}
