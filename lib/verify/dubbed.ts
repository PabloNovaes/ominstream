import { pickByResolution } from '../rank/sort';
import type { Candidate } from '../types';

/**
 * Conferência das versões "dubladas" antes da listagem: o nome do arquivo pode mentir
 * ("Monstros S.A Dublado.mp4" só com áudio em turco e inglês). Lê o cabeçalho de cada arquivo
 * que entraria na lista (as faixas, via HTTP Range, no mesmo link que o /play vai entregar):
 * - todas as faixas marcadas com outro idioma ("DUAL" que é inglês + turco): sai da lista, e a
 *   próxima versão daquela resolução entra no lugar (e é lida)
 * - PT-BR começando antes da faixa original do arquivo (dublagem fora do vídeo): sai também
 * - com faixa PT-BR: fica marcada como conferida
 * - faixas sem etiqueta de idioma, leitura com erro ou tempo esgotado: fica, só com os indícios do texto
 */

/**
 * pt-br: faixa PT-BR no arquivo · other: só outros idiomas marcados · unknown: faixas sem etiqueta ·
 * misaligned: tem PT-BR, mas começando antes da faixa original (dublagem fora do vídeo no próprio arquivo)
 */
export type AudioVerdict = 'pt-br' | 'other' | 'unknown' | 'misaligned';

/** Sai da lista (e a próxima versão daquela resolução entra no lugar) */
const dropped = (v?: AudioVerdict) => v === 'other' || v === 'misaligned';

export type VerifyReport = {
  checked: number;
  confirmed: number;
  /** lidos, mas sem etiqueta de idioma que decida */
  untagged: number;
  /** arquivos descartados e as faixas que tinham (nunca a URL: links de "resolve" levam a chave do TorBox) */
  rejected: { file: string; audio: string[] }[];
  /** com PT-BR fora do vídeo no próprio arquivo */
  misaligned: string[];
  failed: number;
  timedOut?: boolean;
  ms: number;
};

export type VerifyOptions = {
  quotas: Map<number, number>;
  maxProbes: number;
  budgetMs: number;
  /** lê as faixas: `verdict` do arquivo; `audio` = as faixas, para o relatório */
  readAudio: (c: Candidate) => Promise<{ verdict: AudioVerdict; audio: string[] }>;
};

const label = (c: Candidate) => c.filename ?? `${c.urlSource}: item sem nome de arquivo`;

/** @param dubbed versões com indícios de PT-BR, já ordenadas por qualidade */
export async function verifyDubbed(
  dubbed: Candidate[],
  { quotas, maxProbes, budgetMs, readAudio }: VerifyOptions,
): Promise<{ kept: Candidate[]; report: VerifyReport }> {
  const started = Date.now();
  const verdicts = new Map<Candidate, AudioVerdict>();
  const audioOf = new Map<Candidate, string[]>();
  const failed = new Set<Candidate>();
  const probes = new Map<Candidate, Promise<void>>();
  const report: VerifyReport = { checked: 0, confirmed: 0, untagged: 0, rejected: [], misaligned: [], failed: 0, ms: 0 };

  const read = (c: Candidate) => {
    report.checked++;
    const p = readAudio(c).then(
      ({ verdict, audio }) => {
        verdicts.set(c, verdict);
        audioOf.set(c, audio);
      },
      () => { failed.add(c); },
    );
    probes.set(c, p);
    return p;
  };

  // Rodadas: lê o que entraria na lista; cada descarte abre a vaga para o próximo da resolução
  const rounds = (async () => {
    for (;;) {
      const listed = pickByResolution(dubbed.filter(c => !dropped(verdicts.get(c))), quotas);
      // Só torrents do TorBox: links diretos/HLS podem depender de cabeçalhos do app
      const open = listed.filter(c => c.kind === 'debrid' && !verdicts.has(c) && !failed.has(c));
      const fresh = open.filter(c => !probes.has(c)).slice(0, Math.max(0, maxProbes - report.checked));
      fresh.forEach(read);
      const waiting = open.filter(c => probes.has(c));
      if (!waiting.length) return;
      await Promise.all(waiting.map(c => probes.get(c)));
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), budgetMs); });
  const outcome = await Promise.race([rounds.then(() => 'done' as const), timeout]);
  clearTimeout(timer);
  // Estourou o tempo: as leituras seguem em segundo plano e preenchem o cache para a próxima vez
  if (outcome === 'timeout') {
    report.timedOut = true;
    rounds.catch(() => {});
  }

  const kept = dubbed
    .filter(c => !dropped(verdicts.get(c)))
    .map(c => (verdicts.get(c) === 'pt-br' ? { ...c, audioVerified: true } : c));
  for (const [c, verdict] of verdicts) {
    if (verdict === 'pt-br') report.confirmed++;
    else if (verdict === 'unknown') report.untagged++;
    else if (verdict === 'misaligned') report.misaligned.push(label(c));
    else report.rejected.push({ file: label(c), audio: audioOf.get(c) ?? [] });
  }
  report.failed = failed.size;
  report.ms = Date.now() - started;
  return { kept, report };
}
