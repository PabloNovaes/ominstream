import { isValidSecret, json, notFound, preflight, publicOrigin } from '@/lib/http';
import { MANIFEST } from '@/lib/stremio';

export async function GET(req: Request, ctx: RouteContext<'/[secret]/manifest.json'>) {
  const { secret } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();
  // O protocolo exige URL absoluta para o ícone; o endereço vem do próprio pedido
  // Cache curto: o app guarda o manifesto pelo tempo pedido, e catálogos novos demoravam 1 h para aparecer
  return json({ ...MANIFEST, logo: `${publicOrigin(req)}/addon-logo.png` }, { maxAge: 300 });
}

export const OPTIONS = preflight;
