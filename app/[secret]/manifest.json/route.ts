import { isValidSecret, json, notFound, preflight, publicOrigin } from '@/lib/http';
import { MANIFEST } from '@/lib/stremio';

export async function GET(req: Request, ctx: RouteContext<'/[secret]/manifest.json'>) {
  const { secret } = await ctx.params;
  if (!isValidSecret(secret)) return notFound();
  // O protocolo exige URL absoluta para o ícone; o endereço vem do próprio pedido
  return json({ ...MANIFEST, logo: `${publicOrigin(req)}/addon-logo.png` }, { maxAge: 3600 });
}

export const OPTIONS = preflight;
