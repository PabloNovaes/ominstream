import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDubbed } from '../lib/verify/dubbed';
import type { Candidate } from '../lib/types';

const candidate = (filename: string, resolution: Candidate['resolution'], kind: Candidate['kind'] = 'debrid'): Candidate => ({
  kind,
  url: `https://example.test/${encodeURIComponent(filename)}`,
  urlSource: 'teste',
  sources: ['teste'],
  sourceWeight: 1,
  filename,
  rawText: filename,
  resolution,
  hdr: [],
  remux: false,
  cachedHint: true,
});

const quotas = new Map([[1080, 1], [720, 1]]);

test('descarta o "Dublado" sem faixa PT-BR e confere quem entra no lugar', async () => {
  const fake = candidate('Monstros S.A Dublado.mp4', 1080);
  const real = candidate('Monstros.S.A.2001.1080p.BluRay.Dual.mkv', 1080);
  const hd = candidate('Monstros.S.A.2001.Dublado.720p.mp4', 720);
  const read: string[] = [];
  const { kept, report } = await verifyDubbed([fake, real, hd], {
    quotas,
    maxProbes: 10,
    budgetMs: 1000,
    readAudio: async c => {
      read.push(c.filename!);
      return c === fake ? { verdict: 'other', audio: ['tur', 'eng'] } : { verdict: 'pt-br', audio: ['por'] };
    },
  });
  assert.deepEqual(kept.map(c => c.filename), [real.filename, hd.filename]);
  assert.ok(kept.every(c => c.audioVerified));
  assert.deepEqual(report.rejected, [{ file: fake.filename, audio: ['tur', 'eng'] }]);
  // Só lê o que entraria na lista
  assert.deepEqual(read.sort(), [fake.filename, real.filename, hd.filename].sort());
});

test('leitura com erro mantém a opção, sem marca de conferida', async () => {
  const c = candidate('Filme.2020.1080p.Dublado.mkv', 1080);
  const { kept, report } = await verifyDubbed([c], {
    quotas,
    maxProbes: 10,
    budgetMs: 1000,
    readAudio: async () => { throw new Error('sem Range'); },
  });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].audioVerified, undefined);
  assert.equal(report.failed, 1);
});

test('tempo esgotado: lista sai com os indícios do texto', async () => {
  const c = candidate('Filme.2020.1080p.Dublado.mkv', 1080);
  const { kept, report } = await verifyDubbed([c], {
    quotas,
    maxProbes: 10,
    budgetMs: 20,
    readAudio: () => new Promise(resolve => setTimeout(() => resolve({ verdict: 'other', audio: [] }), 200)),
  });
  assert.equal(kept.length, 1);
  assert.equal(report.timedOut, true);
});

test('links diretos não são lidos', async () => {
  const direct = candidate('Filme.2020.1080p.Dublado.mp4', 1080, 'http');
  let reads = 0;
  const { kept } = await verifyDubbed([direct], {
    quotas,
    maxProbes: 10,
    budgetMs: 1000,
    readAudio: async () => { reads++; return { verdict: 'other', audio: [] }; },
  });
  assert.equal(reads, 0);
  assert.equal(kept.length, 1);
});

test('faixa sem etiqueta de idioma não derruba a opção', async () => {
  const c = candidate('Monstros.S.A.2001.Dublado.720p.BRrip.x264.mp4', 720);
  const { kept, report } = await verifyDubbed([c], {
    quotas,
    maxProbes: 10,
    budgetMs: 1000,
    readAudio: async () => ({ verdict: 'unknown', audio: ['?'] }),
  });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].audioVerified, undefined);
  assert.equal(report.untagged, 1);
});
