/**
 * Limite simples de tentativas por chave (ex.: IP), em memória.
 * Na Vercel cada instância tem a sua contagem: protege contra tentativa e erro em sequência,
 * que é o que interessa aqui (o segredo tem 32 caracteres aleatórios).
 */

type Entry = { failures: number; resetAt: number };
const store = new Map<string, Entry>();

export function createLimiter({ maxFailures, windowMs }: { maxFailures: number; windowMs: number }) {
  const current = (key: string): Entry => {
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      const fresh = { failures: 0, resetAt: now + windowMs };
      store.set(key, fresh);
      return fresh;
    }
    return entry;
  };

  return {
    /** Milissegundos até liberar, ou 0 se ainda pode tentar. */
    blockedFor(key: string): number {
      const entry = current(key);
      return entry.failures >= maxFailures ? entry.resetAt - Date.now() : 0;
    },
    /** Registra uma falha e devolve quantas tentativas restam. */
    fail(key: string): number {
      const entry = current(key);
      entry.failures++;
      return Math.max(0, maxFailures - entry.failures);
    },
    reset(key: string) {
      store.delete(key);
    },
  };
}
