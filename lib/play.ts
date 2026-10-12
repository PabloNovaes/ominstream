import { getConfig, type SourceAddon } from './config';
import {
  addCachedTorrent,
  findAccountTorrent,
  getAccountTorrent,
  requestDownloadLink,
  type AccountTorrent,
} from './debrid/torbox';
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
 *
 * CDN mais próximo: o TorBox escolhe o CDN pelo IP de quem pede o link. Links que chegam
 * prontos da fonte (ex.: Comet) vêm com o CDN escolhido para o servidor (nos EUA, na Vercel),
 * o que causava engasgos. Por isso, sempre que o torrent está na conta, o link final é gerado
 * pela API do TorBox com o IP de quem assiste (user_ip).
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

export type PlayResult = { url: string; via: 'torbox' | 'source' };

/**
 * @param clientIp IP de quem vai assistir: repassado ao TorBox (user_ip) para escolher o CDN
 *   mais próximo do usuário, e não do servidor que resolveu o link.
 */
export async function resolvePlay(p: PlayPayload, clientIp?: string): Promise<PlayResult> {
  const apiKey = getConfig().TORBOX_API_KEY;

  // 1) Torrent já na conta: link direto da API do TorBox, sem passar pela fonte
  const direct = await accountLink(apiKey, p, clientIp);
  if (direct) return { url: direct, via: 'torbox' };

  // 2) Fora da conta, mas no cache do TorBox: adiciona (sem iniciar download) e gera o link.
  //    Fontes como o Comet removem o torrent da conta logo após gerar o link delas.
  const added = await addedLink(apiKey, p, clientIp);
  if (added) return { url: added, via: 'torbox' };

  // 3) Resolve pela fonte (isso adiciona o torrent à conta do TorBox)
  const source = getConfig().SOURCES.find(s => s.name === p.s);
  let url = p.u;
  if (source && isIpBound(source)) url = (await freshUrl(source, p)) ?? url;
  const fromSource = await followToCdn(url, clientIp);

  // 4) Agora que está na conta, gera o link com o CDN mais próximo de quem assiste
  const nearest = await accountLink(apiKey, p, clientIp);
  return nearest ? { url: nearest, via: 'torbox' } : { url: fromSource, via: 'source' };
}

/** Link da API do TorBox para o arquivo, se o torrent estiver na conta e pronto. Nunca lança. */
async function accountLink(apiKey: string | undefined, p: PlayPayload, clientIp?: string): Promise<string | null> {
  if (!apiKey || !p.h) return null;
  try {
    const torrent = await findAccountTorrent(apiKey, p.h);
    if (!torrent?.download_finished) return null;
    const fileId = pickFile(torrent, p);
    return fileId === null ? null : await requestDownloadLink(apiKey, torrent.id, fileId, clientIp);
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Adiciona o torrent (só se estiver no cache do TorBox) e gera o link pelo id devolvido.
 * Um torrent recém-adicionado leva alguns instantes para listar os arquivos: tenta algumas vezes.
 */
async function addedLink(apiKey: string | undefined, p: PlayPayload, clientIp?: string): Promise<string | null> {
  if (!apiKey || !p.h) return null;
  const torrentId = await addCachedTorrent(apiKey, p.h).catch(() => null);
  if (!torrentId) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(700);
    const torrent = await getAccountTorrent(apiKey, torrentId).catch(() => null);
    const fileId = torrent ? pickFile(torrent, p) : null;
    if (fileId === null) continue;
    const link = await requestDownloadLink(apiKey, torrentId, fileId, clientIp).catch(() => null);
    if (link) return link;
  }
  return null;
}

/** Arquivo certo dentro do torrent: pelo nome, pelo índice da fonte ou, por fim, o maior vídeo. */
function pickFile(torrent: AccountTorrent, p: PlayPayload): number | null {
  const files = torrent.files ?? [];
  const base = (n: string) => n.split('/').pop()!.toLowerCase();
  const byName = p.f && files.find(f => base(f.short_name ?? f.name) === base(p.f!));
  if (byName) return byName.id;
  const videos = files.filter(f => /\.(mkv|mp4|m4v|avi|mov|ts)$/i.test(f.name));
  if (videos.length === 1) return videos[0].id;
  // Pacotes com vários vídeos (temporadas): sem o nome, só o índice da fonte identifica o episódio
  if (p.i !== undefined && videos.some(f => f.id === p.i)) return p.i;
  return null;
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

// --- Cache dos links resolvidos -------------------------------------------------------
// O player volta ao link /play a cada nova requisição de trecho (início, salto para o índice
// do MKV, avanços, reconexões). Sem cache, cada uma pagava ~1 s para resolver de novo, o que
// aparecia como engasgo. Os links do CDN do TorBox valem por horas; guardamos por 30 min.

const PLAY_CACHE_MS = 30 * 60 * 1000;
const playCache = new Map<string, { result: Promise<PlayResult>; expires: number }>();

/**
 * Como resolvePlay, mas reaproveitando o resultado por 30 min para o mesmo link e o mesmo
 * espectador. Chamadas simultâneas compartilham a mesma resolução. Falhas não ficam guardadas.
 */
export function resolvePlayCached(key: string, p: PlayPayload, clientIp?: string): { result: Promise<PlayResult>; cached: boolean } {
  const now = Date.now();
  const cacheKey = `${key}|${clientIp ?? ''}`;
  const hit = playCache.get(cacheKey);
  if (hit && hit.expires > now) return { result: hit.result, cached: true };

  for (const [k, v] of playCache) if (v.expires <= now) playCache.delete(k); // limpeza
  const result = resolvePlay(p, clientIp);
  playCache.set(cacheKey, { result, expires: now + PLAY_CACHE_MS });
  result.catch(() => playCache.delete(cacheKey));
  return { result, cached: false };
}
