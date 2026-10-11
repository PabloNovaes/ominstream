import { timingSafeEqual } from 'node:crypto';
import { getConfig } from './config';

/** Os apps (Nuvio, Stremio Web) chamam o addon de outro domínio: CORS liberado. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export function json(data: unknown, init: { status?: number; maxAge?: number } = {}) {
  const headers: Record<string, string> = { ...CORS_HEADERS };
  if (init.maxAge) headers['Cache-Control'] = `max-age=${init.maxAge}, public`;
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

/** 404 genérico: não revela se o addon existe para quem não tem o segredo. */
export const notFound = () => json({ err: 'not found' }, { status: 404 });
