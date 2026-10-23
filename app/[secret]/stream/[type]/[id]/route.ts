import { after } from "next/server";
import { isValidSecret, json, notFound, preflight, publicOrigin, viewerIp } from "@/lib/http";
import { getStreams } from "@/lib/pipeline";
import type { RelayedSources } from "@/lib/sources/fetch";
import { logStreams, readRelayed, resolveStreamRequest } from "@/lib/stream-request";

/**
 * GET /<segredo>/stream/<movie|series>/<tt...>.json
 * Com ?debug=1 devolve também o relatório (tempo e volume de cada fonte).
 *
 * POST no mesmo endereço: igual, com o corpo { relayed: { <fonte>: { streams } } } trazendo as
 * listas que o app buscou da rede de casa (fontes que recusam a Vercel, ver RELAY_SOURCES).
 */
export async function GET(
  req: Request,
  ctx: RouteContext<"/[secret]/stream/[type]/[id]">,
) {
  return handle(req, ctx, {});
}

export async function POST(
  req: Request,
  ctx: RouteContext<"/[secret]/stream/[type]/[id]">,
) {
  return handle(req, ctx, await readRelayed(req));
}

async function handle(
  req: Request,
  ctx: RouteContext<"/[secret]/stream/[type]/[id]">,
  relayed: RelayedSources,
) {
  const { secret, type, id } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();

  const resolved = await resolveStreamRequest(type, id);
  if ("empty" in resolved) {
    console.log(`[stream] ${type}/${resolved.rawId} · ${resolved.empty}`);
    return json({ streams: [] }, { maxAge: 60 });
  }
  const { request, rawId } = resolved;

  const { streams, report, cleanup } = await getStreams(request, `${publicOrigin(req)}/${secret}`, viewerIp(req), relayed);
  logStreams("stream", type, rawId, request, report);

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  // Limpeza da conta do TorBox depois da resposta, sem atrasar a lista. No debug roda antes e
  // entra no relatório (o que apagou ou, em simulação, o que apagaria)
  const cleanupLog: string[] = [];
  if (cleanup && debug) await cleanup(line => cleanupLog.push(line));
  else if (cleanup) after(() => cleanup());
  // Busca do par ou conferência do áudio ainda em andamento: sem cache, para a próxima abertura
  // já trazer o 4K e a lista conferida
  const pairPending = report.pair?.timedOut === true || report.verify?.timedOut === true;
  return json(debug ? { streams, report, cleanup: cleanupLog } : { streams }, {
    maxAge: debug || pairPending ? 0 : 300,
  });
}

export const OPTIONS = preflight;
