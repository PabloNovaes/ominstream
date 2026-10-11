import { getConfig, type SourceAddon } from './config';
import { normalize } from './sources/normalize';
import type { ContentType } from './stremio';

/**
 * Resolve o link de play NO SERVIDOR, até o link final do CDN do TorBox.
 *
 * Fontes da ElfHosted (Comet, MediaFusion) prendem o link ao IP de quem pediu a lista.
 * Como a lista é pedida pelo servidor do OminStream e o play vem do app (outro IP), o app
 * via a tela "Wrong IP". Aqui o servidor pede a lista de novo e segue o redirecionamento
 * na mesma hora, do mesmo IP; o app só recebe o link final do CDN, que não é preso a IP.
 * De quebra, o link original (que pode ter a chave do TorBox) nunca chega ao app.
 */

export type PlayPayload = {
  /** link original da fonte */
  u: string;
  /** nome da fonte que gerou o link */
  s: string;
  /** infoHash e índice do arquivo, para achar o mesmo item ao pedir a lista de novo */
  h?: string;
  i?: number;
  /** nome do arquivo (alternativa para achar o item) */
  f?: string;
  /** tipo e id do pedido original ("tt1520211:1:1") */
  t: ContentType;
  id: string;
};

const UA = { 'User-Agent': 'Mozilla/5.0 (OminStream)' };

/** Fontes que prendem o link ao IP: marcadas no SOURCES ou hospedadas na ElfHosted. */
export const isIpBound = (source: SourceAddon) => source.ipBound ?? new URL(source.url).host.endsWith('elfhosted.com');

/**
 * @param clientIp IP de quem vai assistir: repassado ao TorBox (user_ip) para escolher o CDN
 *   mais próximo do usuário, e não do servidor que resolveu o link.
 */
export async function resolvePlay(p: PlayPayload, clientIp?: string): Promise<string> {
  const source = getConfig().SOURCES.find(s => s.name === p.s);
  let url = p.u;
  if (source && isIpBound(source)) url = (await freshUrl(source, p)) ?? url;
  return followToCdn(url, clientIp);
}

/** Pede a lista da fonte de novo (sem cache) e acha o mesmo item: link novo, do IP atual. */
async function freshUrl(source: SourceAddon, p: PlayPayload): Promise<string | null> {
  const base = source.url.replace(/\/manifest\.json$/, '');
  const res = await fetch(`${base}/stream/${p.t}/${p.id}.json`, { headers: UA, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const { streams = [] } = (await res.json()) as { streams?: [] };
  const candidates = normalize([{ source, streams, ms: 0 }]);
  const match =
    (p.h && candidates.find(c => c.infoHash === p.h && (p.i === undefined || c.fileIdx === undefined || c.fileIdx === p.i))) ||
    (p.f && candidates.find(c => c.filename === p.f));
  return match ? match.url : null;
}

// A API do TorBox também é intermediária: o link dela leva a chave (token=...) na URL
const TORBOX_API_HOST = 'api.torbox.app';

/**
 * Segue os redirecionamentos dentro do addon de origem e da API do TorBox, parando no primeiro
 * link de fora (o CDN). Tela de "IP errado" da ElfHosted vira erro.
 */
async function followToCdn(start: string, clientIp?: string): Promise<string> {
  const origin = new URL(start).host;
  let current = start;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(current, { redirect: 'manual', headers: UA, signal: AbortSignal.timeout(20_000) });
    await res.body?.cancel();
    const location = res.headers.get('location');

    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current);
      if (next.host === 'slate.elfhosted.com') throw new Error('a fonte recusou o IP (tela "Wrong IP" da ElfHosted)');
      if (next.host === TORBOX_API_HOST) {
        // CDN escolhido pela localização de quem assiste, não do servidor
        if (clientIp && next.pathname.endsWith('/requestdl')) next.searchParams.set('user_ip', clientIp);
        current = next.toString();
        continue;
      }
      if (next.host !== origin) return next.toString();
      current = next.toString();
      continue;
    }
    // O próprio addon entrega o vídeo (sem redirecionar): o app toca esse link
    if (res.ok) return current;
    throw new Error(`a fonte respondeu HTTP ${res.status} ao resolver o link`);
  }
  throw new Error('redirecionamentos demais');
}
