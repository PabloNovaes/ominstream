import { cacheLife } from 'next/cache';
import { getConfig } from './config';
import { tmdbGet } from './ids';
import type { ContentType } from './stremio';

/**
 * Metadados (página do título) a partir da API do TMDB, em português.
 *
 * Atende IDs "tmdb:1402" e "tt1520211". O Nuvio converte "tmdb:" para IMDb antes de buscar
 * metadados, então sem suporte a "tt" ele caía numa reserva interna SEM lista de episódios e
 * pedia streams da série inteira. Os episódios saem com o mesmo prefixo do ID pedido
 * ("tt1520211:1:1" ou "tmdb:1402:1:1"), formatos que a rota de stream entende.
 */

const IMG = 'https://image.tmdb.org/t/p';

type TmdbGenre = { name: string };
type TmdbMovie = {
  title: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  runtime?: number;
  genres?: TmdbGenre[];
  vote_average?: number;
  imdb_id?: string;
};
type TmdbTv = {
  name: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  genres?: TmdbGenre[];
  vote_average?: number;
  seasons: { season_number: number; episode_count: number }[];
  external_ids?: { imdb_id?: string };
};
type TmdbSeason = {
  episodes: {
    season_number: number;
    episode_number: number;
    name?: string;
    overview?: string;
    air_date?: string | null;
    still_path?: string | null;
    runtime?: number | null;
  }[];
};

export type Meta = Record<string, unknown> & { id: string; type: ContentType; name: string };

const year = (date?: string) => date?.slice(0, 4);
const rating = (v?: number) => (v ? v.toFixed(1) : undefined);

/**
 * Nunca lança: falhas viram null (e não ficam em cache, ver tmdbMetaCached).
 * `id` é o ID pedido pelo app: "tmdb:1402" ou "tt1520211".
 */
export async function tmdbMeta(type: ContentType, id: string): Promise<Meta | null> {
  if (!getConfig().TMDB_API_KEY) return null;
  try {
    return await tmdbMetaCached(type, id);
  } catch (err) {
    console.log(`[meta] falha ao montar ${type}/${id}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** IMDb → TMDB pela busca do TMDB. */
async function tmdbIdFromImdb(type: ContentType, imdbId: string, key: string): Promise<string> {
  const found = await tmdbGet<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(
    `find/${imdbId}?external_source=imdb_id`,
    key,
  );
  const hit = (type === 'movie' ? found.movie_results : found.tv_results)?.[0];
  if (!hit) throw new Error(`${imdbId} não encontrado no TMDB`);
  return String(hit.id);
}

/** Em cache por dias. Lança em caso de falha: erros não entram no cache, então a próxima tentativa refaz. */
async function tmdbMetaCached(type: ContentType, id: string): Promise<Meta> {
  'use cache';
  cacheLife('days');

  const TMDB_API_KEY = getConfig().TMDB_API_KEY!;
  const tmdbId = id.startsWith('tmdb:') ? id.slice(5) : await tmdbIdFromImdb(type, id, TMDB_API_KEY);

  {
    if (type === 'movie') {
      const m = await tmdbGet<TmdbMovie>(`movie/${tmdbId}?language=pt-BR`, TMDB_API_KEY);
      return {
        id,
        type,
        name: m.title,
        imdb_id: m.imdb_id,
        description: m.overview || undefined,
        poster: m.poster_path ? `${IMG}/w500${m.poster_path}` : undefined,
        background: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : undefined,
        releaseInfo: year(m.release_date),
        released: m.release_date ? `${m.release_date}T00:00:00.000Z` : undefined,
        runtime: m.runtime ? `${m.runtime} min` : undefined,
        genres: m.genres?.map(g => g.name),
        imdbRating: rating(m.vote_average),
      };
    }

    const tv = await tmdbGet<TmdbTv>(`tv/${tmdbId}?language=pt-BR&append_to_response=external_ids`, TMDB_API_KEY);
    // Temporada 0 = especiais/extras: fica de fora para não poluir a lista
    const seasonNumbers = tv.seasons.map(s => s.season_number).filter(n => n > 0);
    const seasons = await Promise.all(
      seasonNumbers.map(n =>
        tmdbGet<TmdbSeason>(`tv/${tmdbId}/season/${n}?language=pt-BR`, TMDB_API_KEY).catch(() => ({ episodes: [] })),
      ),
    );

    const videos = seasons
      .flatMap(s => s.episodes)
      .map(ep => ({
        id: `${id}:${ep.season_number}:${ep.episode_number}`,
        title: ep.name || `Episódio ${ep.episode_number}`,
        season: ep.season_number,
        episode: ep.episode_number,
        released: ep.air_date ? `${ep.air_date}T00:00:00.000Z` : undefined,
        overview: ep.overview || undefined,
        thumbnail: ep.still_path ? `${IMG}/w300${ep.still_path}` : undefined,
      }));

    const first = year(tv.first_air_date);
    const last = tv.status === 'Ended' || tv.status === 'Canceled' ? year(tv.last_air_date) : '';
    return {
      id,
      type,
      name: tv.name,
      imdb_id: tv.external_ids?.imdb_id,
      description: tv.overview || undefined,
      poster: tv.poster_path ? `${IMG}/w500${tv.poster_path}` : undefined,
      background: tv.backdrop_path ? `${IMG}/w1280${tv.backdrop_path}` : undefined,
      releaseInfo: first ? `${first}-${last ?? ''}` : undefined,
      genres: tv.genres?.map(g => g.name),
      imdbRating: rating(tv.vote_average),
      videos,
    };
  }
}
