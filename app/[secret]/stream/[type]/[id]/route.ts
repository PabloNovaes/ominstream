import { isValidSecret, json, notFound, preflight, publicOrigin } from "@/lib/http";
import { tmdbToImdb } from "@/lib/ids";
import { getStreams } from "@/lib/pipeline";
import { parseStreamRequest, toStreamRequest } from "@/lib/stremio";

/**
 * GET /<segredo>/stream/<movie|series>/<tt...>.json
 * Com ?debug=1 devolve também o relatório (tempo e volume de cada fonte).
 */
export async function GET(
  req: Request,
  ctx: RouteContext<"/[secret]/stream/[type]/[id]">,
) {
  const { secret, type, id } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();

  const rawId = decodeURIComponent(id).replace(/\.json$/, "");
  const incoming = parseStreamRequest(type, id);
  if (!incoming) {
    // Lista vazia (não 400): para o app, erro HTTP vira "um erro ocorreu"
    console.log(`[stream] ${type}/${rawId} · formato de ID não reconhecido`);
    return json({ streams: [] }, { maxAge: 60 });
  }

  // Títulos do catálogo do TMDB chegam como "tmdb:<id>": as fontes só entendem IMDb
  const imdbId =
    incoming.idType === "imdb"
      ? incoming.baseId
      : await tmdbToImdb(incoming.type, incoming.baseId);
  if (!imdbId) {
    console.log(`[stream] ${type}/${rawId} · sem ID do IMDb correspondente`);
    return json({ streams: [] }, { maxAge: 60 });
  }
  const request = toStreamRequest(incoming, imdbId);

  const { streams, report } = await getStreams(request, `${publicOrigin(req)}/${secret}`);
  console.log(
    `[stream] ${type}/${rawId} → ${request.stremioId} · ${report.returned} streams em ${report.ms}ms · ` +
      report.sources.map((s) => `${s.name}:${s.error ?? s.streams}`).join(" "),
  );

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  return json(debug ? { streams, report } : { streams }, {
    maxAge: debug ? 0 : 300,
  });
}

export const OPTIONS = preflight;
