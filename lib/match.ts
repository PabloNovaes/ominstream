/**
 * Confere se um arquivo de episódio é mesmo da série e do episódio pedidos.
 *
 * As fontes às vezes devolvem episódios de outras séries com nome parecido: para
 * "The Walking Dead S01E01" vieram "Dead City", "World Beyond", "Daryl Dixon" e
 * "Fear the Walking Dead". O nome antes do "S01E01" precisa ser o título da série.
 */

export function normalizeTitle(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EPISODE_MARK = /\bs(\d{1,2})[ ._-]?e(\d{1,3})(?:[ ._-]?(?:-|e)[ ._-]?e?(\d{1,3}))?\b|\b(\d{1,2})x(\d{2,3})\b/i;
const SEASON_ONLY = /\b(?:s(\d{1,2})|season[ ._-]?(\d{1,2})|temporada[ ._-]?(\d{1,2}))\b/i;
// Prefixos de site/grupo no início: "[COMANDO.LA]", "COMANDO.TO - ", "WWW.BLUDV.COM - ", "www.1TamilMV.cz - "
const LEADING_TAGS = /^\s*(?:\[[^\]]*\]\s*)+|^\s*(?:www\.)?[a-z0-9-]+\.(?:com|to|la|net|org|tv|cc|io|cz|me|in)\s*-\s*/i;

/** Trecho do nome antes da marcação de temporada/episódio, sem prefixos de site e sem o ano no fim. */
export function seriesPrefix(filename: string): string {
  let name = filename;
  for (let i = 0; i < 3; i++) name = name.replace(LEADING_TAGS, '');
  const cut = name.search(new RegExp(`${EPISODE_MARK.source}|${SEASON_ONLY.source}`, 'i'));
  const prefix = cut >= 0 ? name.slice(0, cut) : '';
  return normalizeTitle(prefix).replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim();
}

/**
 * true: o nome é da série · false: é de outra série · null: o nome não traz título (não dá para saber)
 */
export function matchesSeriesTitle(filename: string | undefined, titles: string[]): boolean | null {
  if (!filename || !titles.length) return null;
  const prefix = seriesPrefix(filename);
  // Sem título legível antes do episódio (ex.: "1 - Days Gone Bye.mp4", "1x01 - ...")
  if (!/[a-z]{2,}/.test(prefix)) return null;
  return titles.some(t => normalizeTitle(t) === prefix);
}

/** Temporada/episódio(s) indicados no nome do arquivo, se houver. */
export function episodeOf(filename: string): { season: number; from: number; to: number } | null {
  const m = filename.match(EPISODE_MARK);
  if (!m) return null;
  if (m[1]) {
    const from = Number(m[2]);
    return { season: Number(m[1]), from, to: m[3] ? Number(m[3]) : from };
  }
  return { season: Number(m[4]), from: Number(m[5]), to: Number(m[5]) };
}

/** false só quando o nome indica claramente outro episódio. Pacotes de temporada sem episódio passam. */
export function matchesEpisode(filename: string | undefined, season: number, episode: number): boolean {
  if (!filename) return true;
  const ep = episodeOf(filename);
  if (!ep) return true;
  return ep.season === season && episode >= ep.from && episode <= ep.to;
}
