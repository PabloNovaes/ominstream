import { after } from 'next/server';
import { getConfig } from '@/lib/config';
import { cleanupAfterPlay } from '@/lib/debrid/cleanup';
import { isValidSecret, notFound } from '@/lib/http';
import type { PlayPayload } from '@/lib/play';
import { openToken } from '@/lib/token';

/**
 * POST /<segredo>/playing  { "links": ["…/play/<código>", …] }
 * O app avisa o que começou a tocar (o vídeo e, num par 4K, o áudio de outra fonte). Depois da resposta,
 * a conta do TorBox fica só com isso, os protegidos e o que acabou de entrar (ver cleanupAfterPlay).
 */
export async function POST(req: Request, ctx: RouteContext<'/[secret]/playing'>) {
  const { secret } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();

  const body = (await req.json().catch(() => null)) as { links?: unknown } | null;
  const links = Array.isArray(body?.links) ? body.links.filter((l): l is string => typeof l === 'string') : [];
  const hashes = links
    .map(link => link.match(/\/play\/([^/?#]+)/)?.[1])
    .map(token => (token ? openToken<PlayPayload>(token)?.h : undefined))
    .filter((h): h is string => Boolean(h));
  // Nada do TorBox tocando (link direto, outro addon, código inválido): não há o que preservar com certeza
  if (!hashes.length) return new Response(null, { status: 204 });

  const config = getConfig();
  if (config.TORBOX_API_KEY) {
    after(() => cleanupAfterPlay({
      apiKey: config.TORBOX_API_KEY!,
      mode: config.TORBOX_CLEANUP,
      playing: hashes,
      protectedHashes: config.TORBOX_PROTECTED_HASHES,
    }));
  }
  return new Response(null, { status: 202 });
}
