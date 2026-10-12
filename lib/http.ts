import { timingSafeEqual } from 'node:crypto';
import { getConfig } from './config';

/** Os apps (Nuvio, Stremio Web) chamam o addon de outro domínio: CORS liberado. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

/** maxAge 0: resposta provisória, que não pode ficar em cache (no app nem em proxies). */
export function json(data: unknown, init: { status?: number; maxAge?: number } = {}) {
  const headers: Record<string, string> = { ...CORS_HEADERS };
  if (init.maxAge) headers['Cache-Control'] = `max-age=${init.maxAge}, public`;
  else if (init.maxAge === 0) headers['Cache-Control'] = 'no-store';
  return Response.json(data, { status: init.status ?? 200, headers });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

/** Compara o segredo da URL em tempo constante. */
export function isValidSecret(secret: string): boolean {
  const expected = Buffer.from(getConfig().ADDON_SECRET);
  const received = Buffer.from(secret);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Endereço público pelo qual o app chegou (IP da rede local, túnel, domínio da Vercel...).
 * Atrás de proxy, os cabeçalhos X-Forwarded-* trazem o endereço e o protocolo originais.
 */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0] ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * IP público de quem fez o pedido, ou undefined se for de rede local/privada.
 * Importante para o TorBox: um IP privado não tem localização e faz ele escolher o CDN
 * padrão (Europa). Trata IPv4 em formato IPv6 ("::ffff:192.168.15.5") e CGNAT (100.64/10).
 */
export function viewerIp(req: Request): string | undefined {
  const raw = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim();
  if (!raw) return undefined;
  const ip = raw.replace(/^::ffff:/i, '');
  const privateV4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  const privateV6 = /^(::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;
  return privateV4.test(ip) || privateV6.test(ip) ? undefined : ip;
}

/** 404 genérico: não revela se o addon existe para quem não tem o segredo. */
export const notFound = () => json({ err: 'not found' }, { status: 404 });
