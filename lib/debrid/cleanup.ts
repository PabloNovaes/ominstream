import { deleteAccountTorrent, listAccountTorrents, type AccountTorrent } from './torbox';

/**
 * Limpeza dos torrents que o OminStream adicionou à conta do TorBox SÓ para ler o cabeçalho de
 * um arquivo (conferência do áudio, busca do par 4K) e que não foram para a lista.
 *
 * Apagar é irreversível, então TODAS as regras abaixo precisam valer; qualquer dúvida = não apaga:
 * 1. o hash não estava na conta na foto tirada antes das leituras (sem foto, nada é apagado)
 * 2. o arquivo não foi para a lista de opções (pode estar tocando agora pelo autoplay)
 * 3. ninguém pediu /play desse torrent desde o início da busca
 * 4. não está em TORBOX_PROTECTED_HASHES
 * 5. na hora de apagar, existe exatamente UM torrent da conta com esse hash, o id dele não estava
 *    na foto e ele foi criado depois do início da busca (com folga para relógios diferentes)
 */

export type AccountSnapshot = { ids: Set<number>; hashes: Set<string> };

/** Folga entre o relógio do servidor e o do TorBox */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

const norm = (hash: string) => hash.trim().toLowerCase();

export async function takeSnapshot(apiKey: string): Promise<AccountSnapshot> {
  const torrents = await listAccountTorrents(apiKey);
  return {
    ids: new Set(torrents.map(t => t.id)),
    hashes: new Set(torrents.filter(t => t.hash).map(t => norm(t.hash))),
  };
}

// --- /play pedido durante a busca (regra 3) ----------------------------------------------

const playedAt = new Map<string, number>();

/** Chamado pelo /play: esse torrent não sai da conta pela limpeza de nenhuma busca em andamento. */
export function markPlayed(hash: string | undefined) {
  if (!hash) return;
  const now = Date.now();
  playedAt.set(norm(hash), now);
  for (const [h, at] of playedAt) if (now - at > 60 * 60 * 1000) playedAt.delete(h);
}

// --- Decisão ------------------------------------------------------------------------------

export type CleanupDecision = {
  remove: AccountTorrent[];
  /** hash → por que ficou (para o log) */
  kept: { hash: string; reason: string }[];
};

/** Quais torrents da conta podem sair. Pura: tudo o que ela precisa vem nos parâmetros. */
export function pickRemovable(
  account: AccountTorrent[],
  {
    snapshot,
    probedHashes,
    listedHashes,
    protectedHashes,
    sessionStart,
    playedSince = () => false,
  }: {
    snapshot: AccountSnapshot;
    probedHashes: Iterable<string>;
    listedHashes: Iterable<string>;
    protectedHashes: Set<string>;
    sessionStart: number;
    playedSince?: (hash: string) => boolean;
  },
): CleanupDecision {
  const listed = new Set([...listedHashes].map(norm));
  const decision: CleanupDecision = { remove: [], kept: [] };

  for (const hash of new Set([...probedHashes].map(norm))) {
    const keep = (reason: string) => decision.kept.push({ hash, reason });
    if (!hash) continue;
    if (snapshot.hashes.has(hash)) { keep('já estava na conta'); continue; }
    if (listed.has(hash)) { keep('está na lista de opções'); continue; }
    if (protectedHashes.has(hash)) { keep('protegido'); continue; }
    if (playedSince(hash)) { keep('pedido de /play durante a busca'); continue; }

    const matches = account.filter(t => t.hash && norm(t.hash) === hash);
    if (matches.length !== 1) { keep(matches.length ? 'mais de um torrent com esse hash' : 'não está na conta'); continue; }
    const torrent = matches[0];
    if (snapshot.ids.has(torrent.id)) { keep('id já estava na conta'); continue; }
    const created = Date.parse(torrent.created_at ?? '');
    if (!Number.isFinite(created)) { keep('sem data de criação'); continue; }
    if (created < sessionStart - CLOCK_SKEW_MS) { keep('criado antes desta busca'); continue; }

    decision.remove.push(torrent);
  }
  return decision;
}

// --- Execução -----------------------------------------------------------------------------

export type CleanupMode = 'off' | 'dry-run' | 'on';

/**
 * Roda depois da resposta (em segundo plano): espera as leituras terminarem, relê a conta e
 * apaga só o que passar em todas as regras. Nunca lança.
 */
export async function cleanupProbed({
  apiKey,
  mode,
  snapshot,
  sessionStart,
  probesDone,
  probedHashes,
  listedHashes,
  protectedHashes,
  onRemoved,
  log,
}: {
  apiKey: string;
  mode: CleanupMode;
  snapshot: Promise<AccountSnapshot>;
  sessionStart: number;
  probesDone: Promise<unknown>;
  probedHashes: () => Iterable<string>;
  listedHashes: Iterable<string>;
  protectedHashes: Set<string>;
  onRemoved?: (hash: string) => void;
  log?: (line: string) => void;
}): Promise<void> {
  log ??= console.log;
  if (mode === 'off') return;
  try {
    const shot = await snapshot.catch(() => null);
    if (!shot) {
      log('[limpeza] sem a foto da conta: nada é apagado');
      return;
    }
    await probesDone;
    const probed = [...probedHashes()];
    if (!probed.length) return;

    const account = await listAccountTorrents(apiKey);
    const { remove, kept } = pickRemovable(account, {
      snapshot: shot,
      probedHashes: probed,
      listedHashes,
      protectedHashes,
      sessionStart,
      playedSince: hash => (playedAt.get(hash) ?? 0) >= sessionStart,
    });

    for (const torrent of remove) {
      if (mode === 'dry-run') {
        log(`[limpeza] (simulação) apagaria #${torrent.id} ${torrent.name}`);
        continue;
      }
      // Última checagem logo antes de apagar: pode ter sido pedido /play enquanto a lista era lida
      if ((playedAt.get(norm(torrent.hash)) ?? 0) >= sessionStart) {
        log(`[limpeza] mantido #${torrent.id} ${torrent.name}: pedido de /play agora há pouco`);
        continue;
      }
      try {
        await deleteAccountTorrent(apiKey, torrent.id);
        onRemoved?.(norm(torrent.hash));
        log(`[limpeza] apagado #${torrent.id} ${torrent.name}`);
      } catch (err) {
        log(`[limpeza] falhou #${torrent.id} ${torrent.name}: ${err instanceof Error ? err.message : 'erro'}`);
      }
    }
    const count = (reason: string) => kept.filter(k => k.reason === reason).length;
    log(
      `[limpeza] ${probed.length} lidos · ${remove.length} ${mode === 'dry-run' ? 'apagaria' : 'para apagar'} · ` +
        `${count('já estava na conta')} já estavam na conta · ${count('está na lista de opções')} na lista`,
    );
    const notes = kept.filter(k => k.reason !== 'está na lista de opções' && k.reason !== 'já estava na conta');
    if (notes.length) log(`[limpeza] mantidos: ${notes.map(k => `${k.hash.slice(0, 8)} (${k.reason})`).join(', ')}`);
  } catch (err) {
    log(`[limpeza] interrompida, nada mais é apagado: ${err instanceof Error ? err.message : 'erro'}`);
  }
}
