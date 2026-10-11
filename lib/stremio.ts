/**
 * Tipos e utilitários do protocolo de addons do Stremio (usado também pelo Nuvio).
 */

export type ContentType = 'movie' | 'series';

export const MANIFEST = {
  id: 'dev.pablonovaes.ominstream',
  version: '0.3.0',
  name: 'OminStream',
  description:
    'Agrega seus addons de stream, confirma o áudio em português (PT-BR) e mostra só os melhores links dublados.',
  resources: [
    // "tmdb:" para títulos vindos do catálogo do TMDB (convertidos para IMDb antes de consultar as fontes)
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] },
    // Metadados com a lista de episódios. "tt" é essencial: o Nuvio converte "tmdb:" para IMDb
    // antes de procurar quem fornece metadados
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] },
  ],
  types: ['movie', 'series'],
  catalogs: [],
  behaviorHints: { configurable: false, configurationRequired: false },
};

export type StreamRequest = {
  type: ContentType;
  imdbId: string;
  season?: number;
  episode?: number;
  /** id no formato que as fontes entendem: "tt123" ou "tt123:1:2" */
  stremioId: string;
};

/** Pedido ainda com o ID como chegou do app (IMDb ou TMDB). */
export type IncomingRequest = {
  type: ContentType;
  idType: 'imdb' | 'tmdb';
  baseId: string;
  season?: number;
  episode?: number;
};

/**
 * Interpreta o pedido de stream. Filme: "tt1234567" ou "tmdb:693134";
 * episódio: "tt1234567:1:2" ou "tmdb:1396:1:2".
 * O segmento da URL chega com ".json" no fim e com ":" possivelmente codificado.
 */
export function parseStreamRequest(rawType: string, rawId: string): IncomingRequest | null {
  // Alguns clientes usam "tv"/"show" para séries
  const type = ['tv', 'show', 'tvshow'].includes(rawType) ? 'series' : rawType;
  if (type !== 'movie' && type !== 'series') return null;
  const id = decodeURIComponent(rawId).replace(/\.json$/, '');
  const match = id.match(/^(tt\d{5,}|tmdb:\d+)(?::(\d{1,4}):(\d{1,5}))?$/);
  if (!match) return null;

  const [, base, season, episode] = match;
  if (type === 'series' && !season) return null; // série sem episódio não tem stream
  const isTmdb = base.startsWith('tmdb:');
  return {
    type,
    idType: isTmdb ? 'tmdb' : 'imdb',
    baseId: isTmdb ? base.slice(5) : base,
    season: season ? Number(season) : undefined,
    episode: episode ? Number(episode) : undefined,
  };
}

/** Monta o pedido final, já com o ID do IMDb que as fontes usam. */
export function toStreamRequest(incoming: IncomingRequest, imdbId: string): StreamRequest {
  const suffix = incoming.season !== undefined ? `:${incoming.season}:${incoming.episode}` : '';
  return {
    type: incoming.type,
    imdbId,
    season: incoming.season,
    episode: incoming.episode,
    stremioId: `${imdbId}${suffix}`,
  };
}

/** Stream no formato que os apps entendem. */
export type Stream = {
  name: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    filename?: string;
    videoSize?: number;
  };
};
