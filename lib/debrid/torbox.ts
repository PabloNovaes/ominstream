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
