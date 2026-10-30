/**
 * Idiomas das faixas de áudio de um stream DASH (.mpd), lidos no próprio manifesto (alguns KB).
 * O nome pode mentir: o PenguPlay chama de "Portuguese" um .mpd do MovieBox cujo único áudio é o japonês,
 * byte a byte igual ao da versão "Original" (Dragon Ball Super Beerus T1E1).
 */

/** É um manifesto DASH, pelo link (sem o query string) */
export const isDashManifest = (url: string | undefined) => !!url && /\.mpd$/i.test(url.split(/[?#]/)[0]);

/**
 * Idiomas declarados nas AdaptationSets de áudio ("jpn", "por", "pt-BR"...). Lista vazia = áudio sem idioma
 * declarado; null = não deu para ler (erro, tempo esgotado, CDN recusou).
 */
export async function dashAudioLanguages(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 4000,
): Promise<string[] | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const xml = await res.text();
    const sets = xml.match(/<AdaptationSet\b[^>]*>/gi) ?? [];
    return sets
      .filter(tag => /contentType="audio"|mimeType="audio\//i.test(tag))
      .map(tag => tag.match(/\blang="([^"]+)"/i)?.[1])
      .filter((lang): lang is string => Boolean(lang));
  } catch {
    return null;
  }
}

/** Algum dos idiomas é português */
export const hasPortuguese = (langs: string[]) => langs.some(l => /^(pt|por)\b/i.test(l));
