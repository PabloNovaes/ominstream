import { getConfig } from "@/lib/config";
import { isValidSecret, json, notFound, preflight } from "@/lib/http";

/**
 * GET /<segredo>/relay
 * Fontes que o app deve buscar da rede de casa (recusam IPs de data center) e mandar no POST da
 * rota de streams. Os endereços podem levar configuração da fonte: só com o segredo.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();
  const config = getConfig();
  const sources = config.SOURCES.filter(s => config.RELAY_SOURCES.has(s.name.toLowerCase())).map(s => ({
    name: s.name,
    url: s.url,
  }));
  return json({ sources }, { maxAge: 3600 });
}

export const OPTIONS = preflight;
