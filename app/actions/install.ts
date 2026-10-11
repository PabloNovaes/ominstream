'use server';

import { headers } from 'next/headers';
import { isValidSecret } from '@/lib/http';
import { createLimiter } from '@/lib/rate-limit';

/**
 * Valida a chave digitada no modal de instalação e devolve a URL do addon.
 * Server Functions aceitam POST direto (fora da interface): por isso a validação e o
 * limite de tentativas ficam aqui, nunca no cliente.
 */

export type InstallState =
  | { status: 'idle' }
  | { status: 'ok'; manifestUrl: string; stremioUrl: string }
  | { status: 'error'; message: string; attempt: number };

const limiter = createLimiter({ maxFailures: 5, windowMs: 10 * 60 * 1000 });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function requestInstallUrl(prev: InstallState, formData: FormData): Promise<InstallState> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
  const attempt = prev.status === 'error' ? prev.attempt + 1 : 1; // muda a cada envio: reanima o erro

  const blocked = limiter.blockedFor(ip);
  if (blocked > 0) {
    const minutes = Math.ceil(blocked / 60_000);
    return { status: 'error', message: `Muitas tentativas. Tente de novo em ${minutes} min.`, attempt };
  }

  const key = String(formData.get('key') ?? '').trim();
  if (!key) return { status: 'error', message: 'Digite a sua chave de acesso.', attempt };

  if (!isValidSecret(key)) {
    const left = limiter.fail(ip);
    await sleep(500); // atrasa tentativas em sequência
    return {
      status: 'error',
      message: left > 0 ? `Chave inválida. ${left} tentativa${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}.` : 'Chave inválida. Acesso bloqueado por 10 min.',
      attempt,
    };
  }

  limiter.reset(ip);
  // Endereço público pelo qual o usuário chegou (rede local, túnel, Vercel...)
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const proto = h.get('x-forwarded-proto')?.split(',')[0] ?? (isLocal ? 'http' : 'https');
  const manifestUrl = `${proto}://${host}/${key}/manifest.json`;
  return { status: 'ok', manifestUrl, stremioUrl: manifestUrl.replace(/^https?:\/\//, 'stremio://') };
}
