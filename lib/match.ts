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

// "01 - Título.mp4", "Episódio 01 - Título", "Ep. 3 Título": número no início, título depois
const LOOSE_EPISODE = /^\s*(?:(?:epis[oó]dio|episode|ep)\.?\s*)?0*(\d{1,3})\s*[-–._)\]]?\s*(.*)$/i;

/**
 * Arquivos sem a temporada no nome ("1 - O Falcão e o Trapalhão.mp4"): false quando o número no início
 * é de outro episódio, ou quando o título no nome é o de outro episódio da série. Sem como saber
 * (sem número, título que não bate com nenhum episódio conhecido): true.
 */
export function matchesLooseEpisode(
  filename: string | undefined,
  season: number,
  episode: number,
  episodes: { season: number; episode: number; names: string[] }[],
  /** Texto da fonte (nome do pacote: "Os Simpsons - Temporada 28 ...") */
  sourceText = '',
): boolean {
  if (!filename) return true;
  const base = filename.split('/').pop()!;
  if (episodeOf(base)) return true; // tem S01E01/1x01: quem decide é matchesEpisode
  // O pacote diz uma única temporada, e é outra: o "Episódio 01" dele é o de lá
  const packSeasons = seasonsInText(sourceText);
  if (packSeasons.size === 1 && !packSeasons.has(season)) return false;
  const m = base.replace(LEADING_TAGS, '').match(LOOSE_EPISODE);
  if (!m) return true;
  if (Number(m[1]) !== episode) return false;
  const title = normalizeTitle(m[2].replace(/\.[a-z0-9]{2,4}$/i, '').replace(MOVIE_TITLE_END_TAIL, ''));
  if (title.length < 4 || !episodes.length) return true;
  const owner = episodes.find(ep => ep.names.some(n => sameEpisodeTitle(normalizeTitle(n), title)));
  if (!owner) return true;
  return owner.season === season && owner.episode === episode;
}

/**
 * Temporadas citadas no texto ("Temporada 28", "23 Temporada", "28ª Temporada", "Season 6", "S06").
 * Intervalos ("Temporadas 1 a 36", "Stagioni 1 - 36") contam como várias.
 */
export function seasonsInText(text: string): Set<number> {
  const found = new Set<number>();
  const t = text.toLowerCase();
  const range = /\b(?:temporadas?|seasons?|stagioni|saisons?)\s*(\d{1,2})\s*(?:-|–|a|to|al|à)\s*(\d{1,2})\b/i.exec(t);
  if (range) {
    for (let n = Number(range[1]); n <= Number(range[2]) && found.size < 60; n++) found.add(n);
    return found;
  }
  for (const re of [
    /\b(?:temporada|season|stagione|saison)\s*0*(\d{1,2})\b/gi,
    /\b0*(\d{1,2})\s*(?:ª|º|a|o)?\s*temporada\b/gi,
    /\bs0*(\d{1,2})\b(?![ ._-]?e\d)/gi,
  ]) {
    for (const m of t.matchAll(re)) found.add(Number(m[1]));
  }
  return found;
}

/** Título do episódio igual, ou um contido no outro (sufixos de release, "Parte 1"...) */
function sameEpisodeTitle(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  return a === b || (a.length >= 8 && b.includes(a)) || (b.length >= 8 && a.includes(b));
}

// Etiquetas técnicas que às vezes seguem o título do episódio no nome do arquivo
const MOVIE_TITLE_END_TAIL =
  /\b(?:\d{3,4}p|4k|uhd|bluray|web ?dl|webrip|hdtv|x26[45]|h ?26[45]|hevc|dual|dublado|legendado|aac|ac3)\b.*$/i;

// Marca onde termina o título num nome de filme: ano, resolução ou etiqueta técnica
const MOVIE_TITLE_END =
  /\b(?:(?:19|20)\d{2}|\d{3,4}p|4k|uhd|bluray|blu ray|brrip|bdrip|web ?dl|webrip|hdtv|remux|x26[45]|h ?26[45]|hevc|dual|dublado|legendado|portuguese|multi)\b/;

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

const STOPWORDS = new Set(['the', 'and', 'of', 'a', 'o', 'e', 'de', 'do', 'da', 'dos', 'das', 'el', 'la', 'los', 'las', 'le', 'il', 'der', 'die']);

/** Uma palavra do título bate com a do arquivo, tolerando grafias próximas ("Interstelar" × "Interstellar"). */
const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 6 && Math.abs(a.length - b.length) <= 2 && editDistance(a, b) <= Math.floor(a.length / 5));

// Número de continuação logo depois do título: "2", "II", "parte 2", "part ii"
const SEQUEL_MARK = /^(?:(?:part|parte|chapter|capitulo) )?(?:[2-9]|ii|iii|iv|vi|vii|viii|ix)(?: |$)/;

/** O nome traz o título seguido de um número de continuação (outro filme da série). */
function isSequelOf(head: string, title: string): boolean {
  const padded = ` ${head} `;
  const at = padded.indexOf(` ${title} `);
  if (at < 0) return false;
  return SEQUEL_MARK.test(padded.slice(at + title.length + 2));
}

// "e", "and" e "&" são a mesma coisa nos nomes ("Velozes and Furiosos" × "Velozes e Furiosos")
const sameConjunction = (text: string) => text.replace(/(^| )(?:e|and)(?= |$)/g, '$1and');

const YEAR = /\b(?:19|20)\d{2}\b/g;

export interface MovieContext {
  /** Ano de lançamento (TMDB): um ano diferente no nome indica outro filme */
  year?: number;
  /** Títulos dos outros filmes da mesma coleção ("Velozes e Furiosos: Desafio em Tóquio") */
  siblings?: string[];
}

/** O título aparece inteiro no nome, como sequência de palavras. */
const containsWords = (head: string, title: string) => ` ${head} `.includes(` ${title} `);

/**
 * Confere se o arquivo é do filme pedido: algum título conhecido aparece no nome, antes do ano/resolução.
 * true: é o filme · false: é outro filme · null: sem nome legível ou sem títulos (não dá para saber)
 */
export function matchesMovieTitle(
  filename: string | undefined,
  titles: string[],
  context: MovieContext = {},
): boolean | null {
  if (!filename || !titles.length) return null;
  let name = filename;
  for (let i = 0; i < 3; i++) name = name.replace(LEADING_TAGS, '');
  // Nome em outro alfabeto ("Интерстеллар..."): não dá para comparar com títulos latinos
  const firstLetter = name.match(/\p{L}/u)?.[0];
  if (firstLetter && !/\p{Script=Latin}/u.test(firstLetter)) return null;
  const normalized = sameConjunction(normalizeTitle(name.replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '')));
  // Rótulo técnico no lugar do nome ("1080pHLS...-Cinejoy", "AutoHLS"): links diretos sem título
  if (/^(?:\d{3,4}p|4k|auto ?hls|hls)/.test(normalized)) return null;
  const normalizedTitles = titles.map(t => sameConjunction(normalizeTitle(t))).filter(Boolean);
  // O título termina no primeiro ano/etiqueta que não faz parte de um título ("Blade Runner 2049 2017")
  const ends = new RegExp(MOVIE_TITLE_END.source, 'g');
  let end = -1;
  for (const m of normalized.matchAll(ends)) {
    if (/^\d{4}$/.test(m[0]) && normalizedTitles.some(t => containsWords(t, m[0]))) continue;
    end = m.index!;
    break;
  }
  // Sem nada antes do ano/resolução: o título não está no nome
  if (end === 0) return null;
  const head = (end > 0 ? normalized.slice(0, end) : normalized).trim();
  if (!/[a-z]{2,}/.test(head)) return null;
  const headWords = head.split(' ');
  // Ano no nome longe do lançamento: outro filme ("Tokyo Drift 2006" quando o pedido é de 2001).
  // Anos que fazem parte de um título ("Blade Runner 2049") não contam
  if (context.year) {
    const years = (normalized.match(YEAR) ?? []).filter(y => !normalizedTitles.some(t => containsWords(t, y)));
    if (years.length && !years.some(y => Math.abs(Number(y) - context.year!) <= 1)) return false;
  }
  // Outro filme da coleção com título mais longo que o nosso dentro do nome
  // ("the fast and the furious tokyo drift" contém "the fast and the furious", mas é o 3)
  const own = normalizedTitles.filter(t => containsWords(head, t));
  const longestOwn = Math.max(0, ...own.map(t => t.length));
  const sibling = (context.siblings ?? [])
    .map(t => sameConjunction(normalizeTitle(t)))
    .filter(t => t && !normalizedTitles.includes(t));
  if (sibling.some(t => t.length > longestOwn && containsWords(head, t))) return false;
  // Continuação: um título seguido de número ("toy story 2" quando o pedido é "Toy Story"). É outro
  // filme, a menos que algum título traga o nome inteiro ("Toy Story 2" quando o pedido é ele);
  // as regras mais soltas abaixo deixariam passar ("Toy Story: Lá Ele" casa só por "story")
  if (normalizedTitles.some(t => isSequelOf(head, t))) {
    return normalizedTitles.some(t => ` ${head} `.includes(` ${t} `) && !isSequelOf(head, t));
  }
  return normalizedTitles.some(t => {
    // Título inteiro como sequência de palavras ("up altas aventuras" contém "up")
    if (` ${head} `.includes(` ${t} `)) return true;
    // Título colado no resto do nome ("InterstellarM1080"): só para títulos de 4+ letras
    const glued = t.replace(/ /g, '');
    if (glued.length >= 4 && head.replace(/ /g, '').startsWith(glued)) return true;
    // Palavras significativas do título, todas presentes com grafia próxima
    const words = t.split(' ').filter(w => w.length >= 4 && !STOPWORDS.has(w));
    return words.length > 0 && words.every(w => headWords.some(h => sameWord(w, h)));
  });
}
