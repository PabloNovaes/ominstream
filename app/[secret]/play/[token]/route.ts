import { isValidSecret, notFound, viewerIp } from '@/lib/http';
import { playKey, resolvePlayCached, type PlayPayload } from '@/lib/play';
import { openToken } from '@/lib/token';

/**
 * GET /<segredo>/play/<código>
 * Resolve no servidor o link do stream escolhido e redireciona o app para o link final do CDN.
 */
export async function GET(req: Request, ctx: RouteContext<'/[secret]/play/[token]'>) {
  const { secret, token } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();

  const payload = openToken<PlayPayload>(token);
  if (!payload) return notFound();

  const started = Date.now();
  try {
    // IP público de quem vai assistir (na Vercel vem em X-Forwarded-For); IP local não serve ao TorBox
    const clientIp = viewerIp(req);
    const { result, cached } = resolvePlayCached(playKey(payload), payload, clientIp);
    const { url: target, via } = await result;
    // Reaproveitamentos do cache não são registrados: o player faz várias chamadas por play
    if (!cached) {
      console.log(`[play] ${payload.id} · ${payload.s} · ${payload.f ?? '?'} → ${new URL(target).host} (${via === 'torbox' ? 'link do TorBox' : 'link da fonte'}${clientIp ? ', user_ip' : ''}) em ${Date.now() - started}ms`);
    }
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'erro';
    console.log(`[play] ${payload.id} · ${payload.s} · ${payload.f ?? '?'} · FALHOU: ${reason}`);
    return new Response(`Não foi possível abrir este stream: ${reason}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

// Alguns players sondam o link com HEAD antes de tocar
export const HEAD = GET;
