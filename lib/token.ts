import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getConfig } from './config';

/**
 * Códigos opacos para a rota /play: o link original da fonte (que pode conter a chave do
 * TorBox, como no Torrentio e no Magneto) vai CRIPTOGRAFADO (AES-256-GCM) dentro da URL
 * entregue ao app. Só o servidor consegue ler, e qualquer adulteração é detectada.
 */

const key = () => createHash('sha256').update(`ominstream:play:${getConfig().ADDON_SECRET}`).digest();

export function sealToken(payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function openToken<T>(token: string): T | null {
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(data.toString('utf8')) as T;
  } catch {
    return null; // código inválido ou adulterado
  }
}
