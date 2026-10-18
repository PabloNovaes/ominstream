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

/** Títulos conhecidos de um filme (original, pt-BR e alternativos): o nome do arquivo precisa ser um deles. */
export async function movieTitles(imdbId: string): Promise<string[]> {
  'use cache';
  cacheLife('weeks');

  const { TMDB_API_KEY } = getConfig();
  if (!TMDB_API_KEY) return [];
  try {
    const find = await tmdbGet<{ movie_results?: { id: number; title: string; original_title: string }[] }>(
      `find/${imdbId}?external_source=imdb_id`,
      TMDB_API_KEY,
    );
    const movie = find.movie_results?.[0];
    if (!movie) return [];
    const [pt, alt] = await Promise.all([
      tmdbGet<{ title?: string }>(`movie/${movie.id}?language=pt-BR`, TMDB_API_KEY).catch(() => ({ title: undefined })),
      tmdbGet<{ titles?: { title: string }[] }>(`movie/${movie.id}/alternative_titles`, TMDB_API_KEY).catch(() => ({ titles: [] })),
    ]);
    const titles = [movie.title, movie.original_title, pt.title, ...(alt.titles ?? []).map(a => a.title)];
    return [...new Set(titles.filter((t): t is string => Boolean(t)))];
  } catch {
    return [];
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
