import { isValidSecret, json, notFound, preflight } from '@/lib/http';
import { tmdbMeta } from '@/lib/meta';

/**
 * GET /<segredo>/meta/<movie|series>/<tmdb:1402 | tt1520211>.json
 * Metadados com a lista de episódios (ver lib/meta.ts).
 */
export async function GET(_req: Request, ctx: RouteContext<'/[secret]/meta/[type]/[id]'>) {
  const { secret, type, id } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();

  const rawId = decodeURIComponent(id).replace(/\.json$/, '');
  const kind = type === 'movie' ? 'movie' : type === 'series' ? 'series' : null;
  if (!/^(tmdb:\d+|tt\d{5,})$/.test(rawId) || !kind) return json({ meta: null }, { maxAge: 60 });

  const meta = await tmdbMeta(kind, rawId);
  console.log(`[meta] ${type}/${rawId} · ${meta ? `${meta.name}${Array.isArray(meta.videos) ? ` (${meta.videos.length} episódios)` : ''}` : 'não encontrado'}`);
  return json({ meta }, { maxAge: meta ? 86400 : 60 });
}

export const OPTIONS = preflight;
