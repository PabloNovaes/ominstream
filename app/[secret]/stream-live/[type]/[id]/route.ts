import { after } from "next/server";
import { CORS_HEADERS, isValidSecret, notFound, preflight, publicOrigin, viewerIp } from "@/lib/http";
import { getStreams } from "@/lib/pipeline";
import type { RelayedSources } from "@/lib/sources/fetch";
import { logStreams, readRelayed, resolveStreamRequest } from "@/lib/stream-request";

/**
 * GET /<segredo>/stream-live/<movie|series>/<tt...>.json
 * A mesma busca de /stream, entregue aos poucos (NDJSON, uma linha JSON por evento) para o app ir mostrando
 * as fontes enquanto as outras ainda respondem:
 *   {"event":"partial","streams":[...],"done":3,"total":9}  a cada fonte que responde: a lista inteira até agora
 *   {"event":"final","streams":[...]}                       no fim: a lista conferida (áudio PT-BR e par 4K)
 * Cada linha substitui a anterior (não soma). POST: com as listas que o app buscou da rede de casa, como em /stream.
 * Sem cache: cada abertura busca de novo (as fontes ficam 10 min em memória, então repetir é rápido).
 */
export async function GET(
  req: Request,
  ctx: RouteContext<"/[secret]/stream-live/[type]/[id]">,
) {
  return handle(req, ctx, {});
}

export async function POST(
  req: Request,
  ctx: RouteContext<"/[secret]/stream-live/[type]/[id]">,
) {
  return handle(req, ctx, await readRelayed(req));
}

const HEADERS = {
  ...CORS_HEADERS,
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  // Sem buffer em proxies: cada linha sai na hora
  "X-Accel-Buffering": "no",
};

async function handle(
  req: Request,
  ctx: RouteContext<"/[secret]/stream-live/[type]/[id]">,
  relayed: RelayedSources,
) {
  const { secret, type, id } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();

  const resolved = await resolveStreamRequest(type, id);
  const encoder = new TextEncoder();
  const line = (data: unknown) => encoder.encode(`${JSON.stringify(data)}\n`);

  if ("empty" in resolved) {
    console.log(`[stream-live] ${type}/${resolved.rawId} · ${resolved.empty}`);
    return new Response(line({ event: "final", streams: [] }), { headers: HEADERS });
  }
  const { request, rawId } = resolved;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(line(data));
        } catch {
          open = false;   // o app fechou a conexão: a busca termina sozinha
        }
      };
      try {
        const { streams, report, cleanup } = await getStreams(
          request, `${publicOrigin(req)}/${secret}`, viewerIp(req), relayed,
          partial => send({ event: "partial", ...partial }),
        );
        logStreams("stream-live", type, rawId, request, report);
        send({ event: "final", streams });
        if (cleanup) after(() => cleanup());
      } catch (err) {
        console.log(`[stream-live] ${type}/${rawId} · erro: ${err instanceof Error ? err.message : err}`);
        send({ event: "error" });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(body, { headers: HEADERS });
}

export const OPTIONS = preflight;
