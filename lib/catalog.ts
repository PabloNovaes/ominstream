import { cacheLife } from "next/cache";
import { getConfig } from "./config";
import { tmdbGet } from "./ids";
import { normalizeTitle, sameConjunction } from "./match";
import type { ContentType } from "./stremio";

/**
 * Catálogos (seções da tela inicial) e busca, a partir da API do TMDB, em português.
 * Os itens saem com IDs "tmdb:<id>", que as rotas de meta e stream já atendem.
 */

const IMG = "https://image.tmdb.org/t/p";
export const PAGE_SIZE = 20; // tamanho da página do TMDB

type TmdbItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
};
type TmdbPage = { results: TmdbItem[] };

export type MetaPreview = {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  background?: string;
  /** logo do título (arte com o nome), usado nos cards horizontais */
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  posterShape: "poster";
};

// --- Definição das seções ---------------------------------------------------------------

/** Gêneros de filme do TMDB, na ordem em que aparecem na tela inicial. */
const MOVIE_GENRES = [
  { slug: "acao", name: "Ação", id: 28 },
  { slug: "aventura", name: "Aventura", id: 12 },
  { slug: "comedia", name: "Comédia", id: 35 },
  { slug: "terror", name: "Terror", id: 27 },
  { slug: "ficcao", name: "Ficção científica", id: 878 },
  { slug: "suspense", name: "Suspense", id: 53 },
  { slug: "animacao", name: "Animação", id: 16 },
  { slug: "drama", name: "Drama", id: 18 },
  { slug: "romance", name: "Romance", id: 10749 },
  { slug: "crime", name: "Crime", id: 80 },
];

type CatalogDef = {
  id: string;
  type: ContentType;
  name: string;
  /** caminho e parâmetros da API do TMDB para uma página */
  source: (page: number) => string;
  /** lista fechada (ex.: Top 10): só os N primeiros, sem rolagem infinita */
  limit?: number;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const CATALOGS: CatalogDef[] = [
  // Top 10: o app reconhece o "top10" no id e mostra a fileira com os números de posição.
  // O TMDB não tem audiência; os mais populares entre os títulos em streaming no Brasil são a aproximação.
  {
    id: "omin-top10-filmes",
    type: "movie",
    name: "Top 10 filmes no Brasil",
    limit: 10,
    source: () =>
      `discover/movie?language=pt-BR&watch_region=BR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&include_adult=false&page=1`,
  },
  {
    id: "omin-lancamentos",
    type: "movie",
    name: "Filmes lançamentos",
    source: (page) => {
      const today = new Date();
      const from = new Date(today.getTime() - 180 * 86_400_000);
      // Lançados no Brasil nos últimos 6 meses (cinema, digital ou mídia física), pela data daqui,
      // mais recentes primeiro, ignorando os quase desconhecidos
      return `discover/movie?language=pt-BR&region=BR&with_release_type=3|4|5&release_date.gte=${isoDate(from)}&release_date.lte=${isoDate(today)}&sort_by=release_date.desc&vote_count.gte=10&include_adult=false&page=${page}`;
    },
  },
  // {
  //   id: "omin-filmes-populares",
  //   type: "movie",
  //   name: "Filmes populares",
  //   source: (page) => `trending/movie/week?language=pt-BR&page=${page}`,
  // },
  {
    id: "omin-top10-series",
    type: "series",
    name: "Top 10 séries no Brasil",
    limit: 10,
    source: () =>
      `discover/tv?language=pt-BR&watch_region=BR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&include_adult=false&page=1`,
  },
  {
    id: "omin-series-populares",
    type: "series",
    name: "Séries populares",
    source: (page) => `trending/tv/week?language=pt-BR&page=${page}`,
  },
  ...MOVIE_GENRES.map(
    (g): CatalogDef => ({
      id: `omin-genero-${g.slug}`,
      type: "movie",
      // "Filmes de comédia": o nome sozinho ("Comédia") não diz que a fileira é de filmes
      name: `Filmes de ${g.name.toLowerCase()}`,
      source: (page) =>
        `discover/movie?language=pt-BR&region=BR&with_genres=${g.id}&sort_by=popularity.desc&vote_count.gte=100&include_adult=false&page=${page}`,
    }),
  ),
];

/**
 * Busca em quatro fileiras, nesta ordem (o app as exibe na ordem do manifesto):
 * - "Principais": os 10 resultados mais relevantes, filmes e séries misturados;
 * - "Filmes" e "Séries": os demais títulos que são o termo ou começam com ele;
 * - "Mais resultados": correspondências parciais (o termo aparece no meio do título).
 * Nenhum item se repete entre as fileiras. O rótulo de cada fileira é o nome do catálogo (o fork
 * do Nuvio TV mostra o nome sem o sufixo do tipo, e chama a primeira de "Resultados para …");
 * cada item abre pelo próprio tipo.
 */
export const SEARCH_TYPES = {
  main: "principais",
  more: "mais resultados",
} as const;
export const SEARCH_CATALOGS = [
  { id: "omin-busca", type: SEARCH_TYPES.main, name: "Principais" },
  { id: "omin-busca", type: "movie", name: "Filmes" },
  { id: "omin-busca", type: "series", name: "Séries" },
  { id: "omin-busca", type: SEARCH_TYPES.more, name: "Mais resultados" },
];

export type SearchRow = "main" | "movie" | "series" | "more";

// --- Conversão para o formato do app ------------------------------------------------------

function toPreview(item: TmdbItem, type: ContentType): MetaPreview {
  const date = item.release_date || item.first_air_date;
  return {
    id: `tmdb:${item.id}`,
    type,
    name:
      (type === "movie" ? item.title : item.name) ??
      item.original_title ??
      item.original_name ??
      "",
    poster: item.poster_path ? `${IMG}/w780${item.poster_path}` : undefined,
    background: item.backdrop_path
      ? `${IMG}/original${item.backdrop_path}`
      : undefined,
    description: item.overview || undefined,
    releaseInfo: date?.slice(0, 4),
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
    posterShape: "poster",
  };
}

// --- Catálogos ----------------------------------------------------------------------------

/**
 * Uma página de um catálogo. `skip` vem do app (quantos itens já mostrou) e vira a página
 * do TMDB. Em cache por algumas horas: a ordem de popularidade muda devagar.
 */
export async function catalogPage(
  id: string,
  type: ContentType,
  skip = 0,
): Promise<MetaPreview[]> {
  const def = CATALOGS.find((c) => c.id === id && c.type === type);
  if (!def) return [];
  if (def.limit) {
    if (skip > 0) return [];
    const items = (await cachedCatalogPage(id, type, 1)).slice(0, def.limit);
    // Listas curtas e em cards horizontais: o logo vai junto, senão o app troca o nome pelo logo na frente de quem vê
    const logos = await Promise.all(items.map((m) => titleLogo(m.id, type)));
    return items.map((m, i) => (logos[i] ? { ...m, logo: logos[i] } : m));
  }
  // O app soma ao skip os itens que recebeu: uma página com itens sem capa descartados chega
  // com skip um pouco abaixo do múltiplo de 20 ("19"), e ela é a próxima, não a mesma de novo
  const page = Math.ceil(skip / PAGE_SIZE) + 1;
  return cachedCatalogPage(id, type, page);
}

async function cachedCatalogPage(
  id: string,
  type: ContentType,
  page: number,
): Promise<MetaPreview[]> {
  "use cache";
  cacheLife("hours");
  const def = CATALOGS.find((c) => c.id === id && c.type === type)!;
  const data = await tmdbGet<TmdbPage>(
    def.source(page),
    getConfig().TMDB_API_KEY!,
  );
  return data.results
    .filter((r) => r.poster_path)
    .map((r) => toPreview(r, type));
}

type TmdbLogo = {
  file_path: string;
  iso_639_1: string | null;
  iso_3166_1?: string | null;
  width: number;
  vote_average: number;
};

/** Ordem de preferência do idioma do logo: pt-BR, outro português, inglês, sem idioma. */
function logoLangRank(l: TmdbLogo): number {
  if (l.iso_639_1 === "pt") return l.iso_3166_1 === "BR" ? 0 : 1;
  if (l.iso_639_1 === "en") return 2;
  return l.iso_639_1 === null ? 3 : 4;
}

/**
 * Logo de um título no TMDB: o melhor idioma (pt-BR primeiro), PNG antes de SVG (nem todo
 * app do Stremio desenha SVG), depois o mais votado e, empatado, o de maior resolução.
 */
async function titleLogo(
  id: string,
  type: ContentType,
): Promise<string | undefined> {
  "use cache";
  cacheLife("weeks");
  const tmdbId = id.replace(/^tmdb:/, "");
  try {
    const data = await tmdbGet<{ logos?: TmdbLogo[] }>(
      `${type === "movie" ? "movie" : "tv"}/${tmdbId}/images?include_image_language=pt,en,null`,
      getConfig().TMDB_API_KEY!,
    );
    const isSvg = (l: TmdbLogo) => l.file_path.endsWith(".svg");
    const [pick] = (data.logos ?? []).sort(
      (a, b) =>
        logoLangRank(a) - logoLangRank(b) ||
        Number(isSvg(a)) - Number(isSvg(b)) ||
        b.vote_average - a.vote_average ||
        b.width - a.width,
    );
    return pick ? `${IMG}/original${pick.file_path}` : undefined;
  } catch {
    return undefined;
  }
}

// --- Busca --------------------------------------------------------------------------------

/**
 * Pontuação de um resultado: quanto o título bate com o termo (exato > começa com > tem todas
 * as palavras > contém) somado à popularidade e ao número de votos, em escala logarítmica.
 * A relevância pura do TMDB erra ("the walking dead" trazia "The Return" antes da série) e a
 * popularidade pura também ("duna" trazia "Assassinatos em Viena").
 */
export function searchScore(item: TmdbItem, query: string): number {
  const match = titleMatch(item, query);
  if (!match) return 0; // sem relação com o termo: fica de fora, por mais popular que seja
  const popularity =
    Math.log10(1 + (item.popularity ?? 0)) * 15 +
    Math.log10(1 + (item.vote_count ?? 0)) * 10;
  return match + popularity;
}

/** 0 a 85: o quanto algum título (em português ou original) bate com o termo buscado. */
export function titleMatch(item: TmdbItem, query: string): number {
  // "e", "and" e "&" são a mesma palavra: "velozes e furiosos" acha "Velozes & Furiosos 7"
  const q = searchForm(query);
  const titles = [
    item.title ?? item.name,
    item.original_title ?? item.original_name,
  ]
    .filter((t): t is string => Boolean(t))
    .map(searchForm);
  // Palavras de todos os títulos juntas: "velozes e furiosos 2" acha "+ Velozes + Furiosos"
  // (o "2" está só no original, "2 Fast 2 Furious")
  const allTitleWords = new Set(titles.flatMap((t) => t.split(" ")));
  // Palavras de ligação não precisam estar no título ("+ Velozes + Furiosos" não tem o "e")
  const queryWords = q.split(" ").filter((w) => !SEARCH_STOPWORDS.has(w));

  // O exato vale pouco mais que "começa com": entre títulos compatíveis, a popularidade decide.
  // (Com peso alto, filmes obscuros de título original idêntico, como "The Walking Dead" de 1936,
  // passavam na frente de títulos muito mais populares.)
  let match = 0;
  for (const t of titles) {
    if (t === q) match = Math.max(match, 85);
    else if (t.startsWith(`${q} `)) match = Math.max(match, 70);
    else if (t.startsWith(q)) match = Math.max(match, 60);
    else if (queryWords.length > 0 && queryWords.every((w) => t.split(" ").includes(w)))
      match = Math.max(match, 45);
    else if (t.includes(q)) match = Math.max(match, 30);
  }
  if (!match && queryWords.length > 0 && queryWords.every((w) => allTitleWords.has(w))) match = MAIN_MATCH;
  return match;
}

/** Forma comparável de um título ou termo: "+" é "mais" ("+ Velozes + Furiosos"), "e"/"and"/"&" iguais. */
const searchForm = (text: string) => sameConjunction(normalizeTitle(text.replace(/\+/g, " mais ")));

const SEARCH_STOPWORDS = new Set(["and", "the", "of", "a", "o", "as", "os", "de", "do", "da", "dos", "das"]);

const MAIN_SIZE = 10;
// Principais: títulos com todas as palavras do termo; a popularidade escolhe os 10 primeiros
// ("Os Vingadores" de 2012 não começa com "vingadores", mas tem de aparecer no topo)
const MAIN_MATCH = 45;
// Filmes e Séries: o título é o termo ou começa com ele. O resto vai para Mais resultados.
const STRONG_MATCH = 60;

/** Itens de uma fileira da busca (ver SEARCH_CATALOGS). As quatro usam a mesma busca em cache. */
export async function searchRow(
  row: SearchRow,
  query: string,
): Promise<MetaPreview[]> {
  const q = query.trim();
  // One letter already searches: the app waits a moment after each key before asking
  if (q.length < 1) return [];
  const [movies, series] = await Promise.all([
    rankedSearch("movie", q.toLowerCase()),
    rankedSearch("series", q.toLowerCase()),
  ]);
  const all = [...movies, ...series].sort((a, b) => b.score - a.score);

  const main = all.filter((r) => r.match >= MAIN_MATCH).slice(0, MAIN_SIZE);
  const inMain = new Set(main.map((r) => `${r.preview.type}:${r.preview.id}`));
  const rest = all.filter(
    (r) => !inMain.has(`${r.preview.type}:${r.preview.id}`),
  );

  const pick = {
    main: main,
    movie: rest.filter(
      (r) => r.preview.type === "movie" && r.match >= STRONG_MATCH,
    ),
    series: rest.filter(
      (r) => r.preview.type === "series" && r.match >= STRONG_MATCH,
    ),
    more: rest.filter((r) => r.match < STRONG_MATCH),
  }[row];
  return pick.map((r) => r.preview);
}

/** Busca de um tipo, ordenada e com a pontuação de cada item. Em cache por algumas horas. */
async function rankedSearch(
  type: ContentType,
  query: string,
): Promise<{ preview: MetaPreview; score: number; match: number }[]> {
  "use cache";
  cacheLife("hours");
  const key = getConfig().TMDB_API_KEY!;
  const kind = type === "movie" ? "movie" : "tv";
  // Duas páginas em paralelo: mais chance de achar o título popular quando a relevância do TMDB erra
  const pages = await Promise.all(
    [1, 2].map((page) =>
      tmdbGet<TmdbPage>(
        `search/${kind}?query=${encodeURIComponent(query)}&language=pt-BR&include_adult=false&page=${page}`,
        key,
      ).catch(() => ({ results: [] as TmdbItem[] })),
    ),
  );
  const seen = new Set<number>();
  return (
    pages
      .flatMap((p) => p.results)
      .filter((item) => !seen.has(item.id) && seen.add(item.id))
      // Sem capa ou quase sem votos: curtas, making-ofs, vídeos caseiros
      .filter((item) => item.poster_path && (item.vote_count ?? 0) >= 5)
      .map((item) => ({ item, score: searchScore(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map(({ item, score }) => ({
        preview: toPreview(item, type),
        score,
        match: titleMatch(item, query),
      }))
  );
}
