import { cacheLife } from 'next/cache';
import { getConfig } from './config';
import type { ContentType } from './stremio';

/**
 * Converte IDs do TMDB ("tmdb:693134") para IMDb ("tt15239678"), que é o formato
 * aceito pelas fontes (Torrentio, Comet, MediaFusion...).
 *
 * 1º: API oficial do TMDB (rápida, ~100 ms) quando TMDB_API_KEY existe.
 * 2º: meta do addon do TMDB instalado no Nuvio (META_ADDON_URL), mais lento.
 * O mapeamento nunca muda, então fica em cache pelo maior tempo possível.
 */
export async function tmdbToImdb(type: ContentType, tmdbId: string): Promise<string | null> {
  'use cache';
  cacheLife('max');

  const { TMDB_API_KEY, META_ADDON_URL } = getConfig();
  if (TMDB_API_KEY) {
    const imdb = await fromTmdbApi(type, tmdbId, TMDB_API_KEY).catch(() => null);
    if (imdb) return imdb;
  }
  if (META_ADDON_URL) {
    return fromMetaAddon(type, tmdbId, META_ADDON_URL).catch(() => null);
  }
  return null;
}

async function fromTmdbApi(type: ContentType, tmdbId: string, key: string): Promise<string | null> {
  const kind = type === 'movie' ? 'movie' : 'tv';
  // Aceita a chave v3 (curta) ou o token de leitura v4 (JWT longo)
  const isBearer = key.length > 40;
  const url = new URL(`https://api.themoviedb.org/3/${kind}/${tmdbId}/external_ids`);
  if (!isBearer) url.searchParams.set('api_key', key);
  const res = await fetch(url, {
    headers: isBearer ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { imdb_id?: string | null };
  return body.imdb_id && /^tt\d+$/.test(body.imdb_id) ? body.imdb_id : null;
}

async function fromMetaAddon(type: ContentType, tmdbId: string, manifestUrl: string): Promise<string | null> {
  const base = manifestUrl.replace(/\/manifest\.json$/, '');
  const res = await fetch(`${base}/meta/${type}/tmdb:${tmdbId}.json`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { meta?: { imdb_id?: string } };
  const imdb = body.meta?.imdb_id;
  return imdb && /^tt\d+$/.test(imdb) ? imdb : null;
}

/**
 * Títulos de uma série (inglês, original, português e alternativos) a partir do ID do IMDb,
 * para recusar episódios de outras séries com nome parecido. Sem chave do TMDB: lista vazia
 * (a validação de título é pulada).
 */
export async function seriesTitles(imdbId: string): Promise<string[]> {
  'use cache';
  cacheLife('weeks');

  const { TMDB_API_KEY } = getConfig();
  if (!TMDB_API_KEY) return [];
  try {
    const find = await tmdbGet<{ tv_results?: { id: number; name: string; original_name: string }[] }>(
      `find/${imdbId}?external_source=imdb_id`,
      TMDB_API_KEY,
    );
    const show = find.tv_results?.[0];
    if (!show) return [];
    const [pt, alt] = await Promise.all([
      tmdbGet<{ name?: string }>(`tv/${show.id}?language=pt-BR`, TMDB_API_KEY).catch(() => ({ name: undefined })),
      tmdbGet<{ results?: { title: string }[] }>(`tv/${show.id}/alternative_titles`, TMDB_API_KEY).catch(() => ({ results: [] })),
    ]);
    const titles = [show.name, show.original_name, pt.name, ...(alt.results ?? []).map(a => a.title)];
    return [...new Set(titles.filter((t): t is string => Boolean(t)))];
  } catch {
    return [];
  }
}

export interface MovieInfo {
  /** Títulos conhecidos (original, pt-BR e alternativos): o nome do arquivo precisa ser um deles */
  titles: string[];
  /** Ano de lançamento */
  year?: number;
  /** Títulos dos outros filmes da mesma coleção (original, en-US e pt-BR) */
  siblings: string[];
}

type TmdbCollection = { parts?: { id: number; title?: string; original_title?: string }[] };

/** Títulos, ano e filmes irmãos (coleção) de um filme, para separar os arquivos dele dos de continuações. */
export async function movieInfo(imdbId: string): Promise<MovieInfo> {
  'use cache';
  cacheLife('weeks');

  const empty: MovieInfo = { titles: [], siblings: [] };
  const { TMDB_API_KEY } = getConfig();
  if (!TMDB_API_KEY) return empty;
  try {
    const find = await tmdbGet<{ movie_results?: { id: number; title: string; original_title: string }[] }>(
      `find/${imdbId}?external_source=imdb_id`,
      TMDB_API_KEY,
    );
    const movie = find.movie_results?.[0];
    if (!movie) return empty;
    const [pt, alt] = await Promise.all([
      tmdbGet<{ title?: string; release_date?: string; belongs_to_collection?: { id: number } | null }>(
        `movie/${movie.id}?language=pt-BR`,
        TMDB_API_KEY,
      ).catch(() => ({ title: undefined, release_date: undefined, belongs_to_collection: null })),
      tmdbGet<{ titles?: { title: string }[] }>(`movie/${movie.id}/alternative_titles`, TMDB_API_KEY).catch(() => ({ titles: [] })),
    ]);
    const titles = [movie.title, movie.original_title, pt.title, ...(alt.titles ?? []).map(a => a.title)];
    const year = Number(pt.release_date?.slice(0, 4)) || undefined;

    const siblings: string[] = [];
    const collectionId = pt.belongs_to_collection?.id;
    if (collectionId) {
      const collections = await Promise.all(
        ['pt-BR', 'en-US'].map(lang =>
          tmdbGet<TmdbCollection>(`collection/${collectionId}?language=${lang}`, TMDB_API_KEY).catch(() => ({ parts: [] })),
        ),
      );
      for (const part of collections.flatMap(c => c.parts ?? [])) {
        if (part.id === movie.id) continue;
        if (part.title) siblings.push(part.title);
        if (part.original_title) siblings.push(part.original_title);
      }
    }
    const unique = (list: (string | undefined)[]) => [...new Set(list.filter((t): t is string => Boolean(t)))];
    return { titles: unique(titles), year, siblings: unique(siblings) };
  } catch {
    return empty;
  }
}

export async function tmdbGet<T>(path: string, key: string): Promise<T> {
  const isBearer = key.length > 40;
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  if (!isBearer) url.searchParams.set('api_key', key);
  const res = await fetch(url, {
    headers: isBearer ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`TMDB ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export type EpisodeName = { season: number; episode: number; names: string[] };

/**
 * Nomes de todos os episódios da série (pt-BR e inglês), para reconhecer o episódio pelo título no
 * nome do arquivo quando ele não traz a temporada ("01 - O Circo de Lembranças de Monty Burns.mp4").
 */
export async function seriesEpisodeNames(imdbId: string): Promise<EpisodeName[]> {
  'use cache';
  cacheLife('weeks');

  const { TMDB_API_KEY } = getConfig();
  if (!TMDB_API_KEY) return [];
  try {
    const find = await tmdbGet<{ tv_results?: { id: number }[] }>(`find/${imdbId}?external_source=imdb_id`, TMDB_API_KEY);
    const showId = find.tv_results?.[0]?.id;
    if (!showId) return [];
    const tv = await tmdbGet<{ seasons?: { season_number: number }[] }>(`tv/${showId}`, TMDB_API_KEY);
    const seasons = (tv.seasons ?? []).map(x => x.season_number).filter(n => n > 0);
    type Season = { episodes?: { season_number: number; episode_number: number; name?: string }[] };
    const fetchSeason = (n: number, lang: string) =>
      tmdbGet<Season>(`tv/${showId}/season/${n}?language=${lang}`, TMDB_API_KEY).catch(() => ({ episodes: [] }) as Season);
    const all = await Promise.all(seasons.flatMap(n => [fetchSeason(n, 'pt-BR'), fetchSeason(n, 'en-US')]));
    const byKey = new Map<string, EpisodeName>();
    for (const season of all) {
      for (const ep of season.episodes ?? []) {
        const key = `${ep.season_number}:${ep.episode_number}`;
        const entry = byKey.get(key) ?? { season: ep.season_number, episode: ep.episode_number, names: [] };
        if (ep.name && !/^epis[oó]dio \d+$/i.test(ep.name) && !entry.names.includes(ep.name)) entry.names.push(ep.name);
        byKey.set(key, entry);
      }
    }
    return [...byKey.values()];
  } catch {
    return [];
  }
}
