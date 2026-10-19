import { catalogPage, searchRow, SEARCH_TYPES, type SearchRow } from '@/lib/catalog';
import { isValidSecret, json, notFound, preflight } from '@/lib/http';

/**
 * GET /<segredo>/catalog/<movie|series>/<id>.json
 * GET /<segredo>/catalog/<movie|series>/<id>/<extras>.json   (extras: "skip=20")
 * GET /<segredo>/catalog/<principais|movie|series|mais resultados>/omin-busca/search=<termo>.json
 */
export async function GET(_req: Request, ctx: RouteContext<'/[secret]/catalog/[type]/[...path]'>) {
  const { secret, type: rawType, path } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();
  const type = decodeURIComponent(rawType); // "mais resultados" chega como "mais%20resultados"

  const [rawId, rawExtra] = path.map(p => decodeURIComponent(p).replace(/\.json$/, ''));
  const extra = new URLSearchParams(rawExtra ?? '');
  const started = Date.now();

  // Busca: Principais, Filmes, Séries e Mais resultados (ver SEARCH_CATALOGS)
  const query = extra.get('search');
  if (query !== null) {
    const row: SearchRow | null =
      type === SEARCH_TYPES.main ? 'main' : type === SEARCH_TYPES.more ? 'more' : type === 'movie' || type === 'series' ? type : null;
    const metas = row ? await searchRow(row, query).catch(() => []) : [];
    console.log(`[busca] ${type} "${query}" · ${metas.length} resultados em ${Date.now() - started}ms`);
    // Curto: o app guarda a resposta pelo max-age, e uma correção da busca demoraria a aparecer
    return json({ metas }, { maxAge: 120 });
  }

  if (type !== 'movie' && type !== 'series') return json({ metas: [] }, { status: 400 });
  const skip = Number(extra.get('skip') ?? 0) || 0;
  const metas = await catalogPage(rawId, type, skip).catch(() => []);
  return json({ metas }, { maxAge: 3600 });
}

export const OPTIONS = preflight;
