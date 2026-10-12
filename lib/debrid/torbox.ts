/**
 * Cliente mínimo da API do TorBox.
 */

const API = 'https://api.torbox.app/v1/api';

export type CachedTorrent = {
  hash: string;
  name: string;
  size: number;
  files?: { id: number; name: string; size: number }[];
};

/**
 * Quais hashes estão no cache do TorBox (tocam na hora, sem download).
 * A API devolve só os que estão em cache; os demais simplesmente não aparecem.
 */
export async function checkCached(
  apiKey: string,
  hashes: string[],
  { listFiles = false, timeoutMs = 5000 } = {},
): Promise<Map<string, CachedTorrent>> {
  const result = new Map<string, CachedTorrent>();
  const unique = [...new Set(hashes.map(h => h.toLowerCase()))];

  // Lotes de 100 para não estourar o tamanho da requisição
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await fetch(`${API}/torrents/checkcached?format=list&list_files=${listFiles}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: batch }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`TorBox checkcached: HTTP ${res.status}`);
    const body = (await res.json()) as { success: boolean; data?: CachedTorrent[]; detail?: string };
    if (!body.success) throw new Error(`TorBox checkcached: ${body.detail ?? 'falhou'}`);
    for (const t of body.data ?? []) result.set(t.hash.toLowerCase(), t);
  }
  return result;
}

export type AccountTorrent = {
  id: number;
  hash: string;
  name: string;
  download_finished: boolean;
  files?: { id: number; name: string; short_name?: string; size: number }[];
};

/** Torrent da conta com esse hash (já adicionado e baixado), se existir. */
export async function findAccountTorrent(apiKey: string, hash: string): Promise<AccountTorrent | null> {
  const res = await fetch(`${API}/torrents/mylist?bypass_cache=true`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`TorBox mylist: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: AccountTorrent[] };
  return body.data?.find(t => t.hash?.toLowerCase() === hash.toLowerCase()) ?? null;
}

/**
 * Link de download (CDN) de um arquivo da conta. Com `userIp`, o TorBox escolhe o CDN mais
 * próximo de quem vai assistir, e não de quem fez o pedido (o servidor).
 */
export async function requestDownloadLink(
  apiKey: string,
  torrentId: number,
  fileId: number,
  userIp?: string,
): Promise<string> {
  const qs = new URLSearchParams({ token: apiKey, torrent_id: String(torrentId), file_id: String(fileId) });
  if (userIp) qs.set('user_ip', userIp);
  const res = await fetch(`${API}/torrents/requestdl?${qs}`, { signal: AbortSignal.timeout(8000) });
  const body = (await res.json()) as { success?: boolean; data?: string; detail?: string };
  if (!res.ok || !body.success || !body.data) throw new Error(`TorBox requestdl: ${body.detail ?? `HTTP ${res.status}`}`);
  return body.data;
}

/**
 * Adiciona um torrent à conta só se ele já estiver no cache do TorBox (nunca inicia download).
 * Retorna o id do torrent na conta, ou null se não estiver em cache.
 */
export async function addCachedTorrent(apiKey: string, hash: string): Promise<number | null> {
  const form = new FormData();
  form.set('magnet', `magnet:?xt=urn:btih:${hash}`);
  form.set('add_only_if_cached', 'true');
  form.set('seed', '3'); // 3 = não semear
  const res = await fetch(`${API}/torrents/createtorrent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { success?: boolean; data?: { torrent_id?: number }; detail?: string };
  return body.success && body.data?.torrent_id ? body.data.torrent_id : null;
}

/** Um torrent da conta pelo id (para torrents recém-adicionados, antes de aparecerem prontos na lista). */
export async function getAccountTorrent(apiKey: string, id: number): Promise<AccountTorrent | null> {
  const res = await fetch(`${API}/torrents/mylist?id=${id}&bypass_cache=true`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: AccountTorrent | AccountTorrent[] };
  return (Array.isArray(body.data) ? body.data[0] : body.data) ?? null;
}
