import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioPartners, editionOf, originOf } from '../lib/pair';
import type { Candidate } from '../lib/types';

const candidate = (filename: string, kind: Candidate['kind'] = 'debrid'): Candidate => ({
  kind,
  url: `https://example.test/${encodeURIComponent(filename)}`,
  urlSource: 'teste',
  sources: ['teste'],
  sourceWeight: 1,
  filename,
  rawText: filename,
  resolution: null,
  hdr: [],
  remux: false,
  cachedHint: true,
});

test('origem do release', () => {
  assert.equal(originOf('Inside Out (2015) 2160p BluRay x265 HDR (Tigole).mkv'), 'bluray');
  assert.equal(originOf('Divertida Mente 2015 1080p BluRay x264-RK Dual Audio.mkv'), 'bluray');
  assert.equal(originOf('Movie.2160p.UHD.BluRay.REMUX.HDR.HEVC.mkv'), 'bluray');
  assert.equal(originOf('Movie.2023.1080p.WEB-DL.DUAL.DDP5.1.mkv'), 'web');
  assert.equal(originOf('Movie.2023.2160p.WEBRip.x265.mkv'), 'web');
  assert.equal(originOf('Show.S01E01.720p.HDTV.x264.mkv'), 'hdtv');
  assert.equal(originOf('Movie 2023 Dublado.mp4'), 'other');
});

test('corte do filme', () => {
  assert.equal(editionOf('Inside Out (2015) 2160p BluRay x265 HDR (Tigole).mkv'), '');
  assert.equal(editionOf('Aliens.1986.Extended.2160p.UHD.BluRay.mkv'), 'extended');
  assert.equal(editionOf("Blade Runner 1982 The Final Cut Director's Cut 1080p"), 'directors');
  assert.equal(editionOf('Movie.2160p.IMAX.Remastered.mkv'), ''); // muda só a imagem
});

test('parceiros: mesmo corte obrigatório, mesma origem primeiro, link direto por último', () => {
  const video = candidate('Movie.2019.2160p.BluRay.x265.HDR.mkv');
  const web = candidate('Movie.2019.1080p.WEB-DL.DUAL.mkv');
  const bluray = candidate('Movie.2019.1080p.BluRay.DUAL.mkv');
  const extended = candidate('Movie.2019.Extended.1080p.BluRay.DUAL.mkv');
  const direct = candidate('Movie.2019.1080p.BluRay.Dublado.mp4', 'http');

  assert.deepEqual(
    audioPartners(video, [web, bluray, extended, direct]).map(c => c.filename),
    [bluray.filename, web.filename, direct.filename],
  );
});

test('versão estendida só combina com versão estendida', () => {
  const video = candidate('Aliens.1986.Extended.2160p.BluRay.mkv');
  const theatrical = candidate('Aliens.1986.1080p.BluRay.DUAL.mkv');
  const extended = candidate('Aliens.1986.Extended.1080p.BluRay.DUAL.mkv');
  assert.deepEqual(audioPartners(video, [theatrical, extended]).map(c => c.filename), [extended.filename]);
});

test('4K sem origem no nome prefere BluRay e "Dual"; item sem nome de arquivo vai por último', () => {
  const video = { ...candidate('Coraline e la porta magica (2009) 2160p H265 10 bit DV HDR10+ ita eng.mkv'), resolution: 2160 as const };
  const noName = { ...candidate('x'), filename: undefined, rawText: 'Coraline Dual Audio PT-EN' };
  const other = candidate('Coraline e o Mundo Secreto 1080p - Filmes Beta.mp4');
  const web = candidate('Coraline.2009.1080p.AMZN.WEB-DL.DUAL-FF.mkv');
  const bluray = candidate('Coraline e o Mundo Secreto [2009] - BluRay 1080p Dual Áudio.mkv');
  assert.deepEqual(
    audioPartners(video, [noName, other, web, bluray]).map(c => c.filename ?? 'sem nome'),
    [bluray.filename, web.filename, other.filename, 'sem nome'],
  );
});
