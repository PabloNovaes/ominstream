import { after } from "next/server";
import { isValidSecret, json, notFound, preflight, publicOrigin, viewerIp } from "@/lib/http";
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

  const { streams, report, cleanup } = await getStreams(request, `${publicOrigin(req)}/${secret}`, viewerIp(req));
  console.log(
    `[stream] ${type}/${rawId} → ${request.stremioId} · ${report.returned} streams em ${report.ms}ms · ` +
      report.sources.map((s) => `${s.name}:${s.error ?? s.streams}`).join(" ") +
      (report.verify
        ? ` · áudio conferido: ${report.verify.confirmed} ok, ${report.verify.untagged} sem etiqueta, ${report.verify.rejected.length} sem PT-BR` +
          `${report.verify.timedOut ? ", tempo esgotado" : ""} (${report.verify.ms}ms)`
        : "") +
      (report.pair ? ` · par 4K: ${report.pair.chosen ? "ok" : report.pair.timedOut ? "tempo esgotado" : "não"} (${report.pair.ms}ms)` : ""),
  );

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
