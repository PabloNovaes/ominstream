import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortByQuality, sortByVideoFidelity } from '../lib/rank/sort';
import type { Candidate } from '../lib/types';

const candidate = (filename: string, props: Partial<Candidate>): Candidate => ({
  kind: 'debrid',
  url: `https://example.test/${encodeURIComponent(filename)}`,
  urlSource: 'teste',
  sources: ['teste'],
  sourceWeight: 1,
  filename,
  rawText: filename,
  resolution: 2160,
  hdr: [],
  remux: false,
  cachedHint: true,
  ...props,
});

// Os três 4K de Coraline testados para o par
const encodeHdr10Plus = candidate('Coraline (2009) 2160p H265 10 bit DV HDR10+ Licdom.mkv', { hdr: ['DV', 'HDR10+'], codec: 'hevc', sizeBytes: 20e9 });
const remuxDv = candidate('Coraline.2009.UHDBD.2160p.DV.HDR10.HEVC.Remux-pmHD.mkv', { hdr: ['DV', 'HDR10'], remux: true, codec: 'hevc', sizeBytes: 60e9 });
const remuxNoDv = candidate('Coraline.2009.2160p.UHD.BluRay.REMUX.HDR10.mkv', { hdr: ['HDR10'], remux: true, codec: 'hevc', sizeBytes: 55e9 });
const encodeNoDv = candidate('Coraline.2009.2160p.BluRay.HDR10+.x265.mkv', { hdr: ['HDR10+'], codec: 'hevc', sizeBytes: 15e9 });

test('vídeo do par: remux à frente de HDR10+ num encode', () => {
  assert.deepEqual(sortByVideoFidelity([encodeHdr10Plus, remuxDv]).map(c => c.filename), [remuxDv.filename, encodeHdr10Plus.filename]);
});

test('vídeo do par: Dolby Vision ainda vem antes do remux', () => {
  assert.deepEqual(
    sortByVideoFidelity([remuxNoDv, encodeNoDv, encodeHdr10Plus, remuxDv]).map(c => c.filename),
    [remuxDv.filename, encodeHdr10Plus.filename, remuxNoDv.filename, encodeNoDv.filename],
  );
});

test('lista dublada mantém a ordem de antes (HDR10+ conta mais que remux)', () => {
  assert.equal(sortByQuality([remuxDv, encodeHdr10Plus])[0].filename, encodeHdr10Plus.filename);
});
