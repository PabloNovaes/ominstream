import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioPartners, dubMisaligned, editionOf, fpsOf, orderBySpeed, originOf, pairVideoPool, ptLagOf, sameSpeed } from '../lib/pair';
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

test('velocidade: a taxa de quadros vem do DefaultDuration da faixa de vídeo', () => {
  assert.equal(fpsOf([{ type: 'audio' }, { type: 'video', frameDurationNs: 41708333 }])?.toFixed(3), '23.976');
  assert.equal(fpsOf([{ type: 'video', frameDurationNs: 41666667 }])?.toFixed(3), '24.000');
  assert.equal(fpsOf([{ type: 'video' }, { type: 'audio' }]), undefined);
});

test('velocidade: 23,976 × 24 qps não forma par (Loki T1E1); arredondamento e taxa desconhecida passam', () => {
  const ntsc = 24000 / 1001;
  assert.equal(sameSpeed(ntsc, 24), false);
  assert.equal(sameSpeed(ntsc, 25), false); // dublagem PAL
  assert.equal(sameSpeed(ntsc, 1e9 / 41708000), true); // mesmo 23,976, cabeçalho arredondado
  assert.equal(sameSpeed(24, 24), true);
  assert.equal(sameSpeed(undefined, 24), true);
  assert.equal(sameSpeed(ntsc, undefined), true);
});

test('dublagem fora do vídeo: PT-BR começando 1 s ou mais antes da faixa original sai (Loki T1E1, Vinci)', () => {
  // Vinci: português em 0, inglês (do mesmo release que o vídeo) em 2,985 s
  const vinci = ptLagOf([{ startSec: 0 }, { startSec: 2.985 }], ['pt-br', 'other']);
  assert.equal(vinci?.toFixed(3), '-2.985');
  assert.equal(dubMisaligned({ ptLagSec: vinci }), true);
  // O inglês do Vinci vem sem etiqueta de idioma: vale como original do mesmo jeito
  assert.equal(dubMisaligned({ ptLagSec: ptLagOf([{ startSec: 0 }, { startSec: 2.985 }], ['pt-br', 'unknown']) }), true);
  // Faixas juntas, ou dublagem começando depois (sem as vinhetas do início): fica
  assert.equal(dubMisaligned({ ptLagSec: ptLagOf([{ startSec: 0 }, { startSec: 0 }], ['pt-br', 'other']) }), false);
  assert.equal(dubMisaligned({ ptLagSec: ptLagOf([{ startSec: 3 }, { startSec: 0 }], ['pt-br', 'other']) }), false);
  // Sem a faixa original lida, ou só PT-BR: não dá para dizer, fica
  assert.equal(ptLagOf([{ startSec: 0 }, {}], ['pt-br', 'other']), undefined);
  assert.equal(ptLagOf([{ startSec: 0 }], ['pt-br']), undefined);
  assert.equal(dubMisaligned({}), false);
});

test('4K a testar: os melhores e também os da origem das dublagens (Loki: BluRay no topo, dublagens do Disney+)', () => {
  const bd = ['Remux', 'BDRip', 'BluRay.x265'].map(n => candidate(`Loki.S01E01.2160p.UHD.${n}.mkv`));
  const web = candidate('Loki.S01E01.2160p.DSNP.WEB-DL.DDP5.1.Atmos.HDR.HEVC-CMRG.mkv');
  const web2 = candidate('Loki.S01E01.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX.mkv');
  const dub = candidate('Loki.S01E01.1080p.DSNP.WEB-DL.DUAL-alfaHD.mkv');
  assert.deepEqual(pairVideoPool([...bd, web, web2], [dub], 3), [...bd, web, web2]);
  // Dublagem de BluRay: nada a acrescentar
  assert.deepEqual(pairVideoPool([...bd, web], [candidate('Loki.1080p.BluRay.DUAL.mkv')], 3), bd);
});

test('ordem pela velocidade: primeiro quem combina com uma dublagem; quem não combina com nenhuma sai', () => {
  const ntsc = 24000 / 1001;
  const fps: Record<string, number | undefined> = { bd: ntsc, web: 24, unknown: undefined };
  // Dublagens a 24 (Disney+): o 4K WEB vai na frente, o BluRay sai, o desconhecido fica no fim
  assert.deepEqual(orderBySpeed(['bd', 'web', 'unknown'], v => fps[v], [24, 24]), ['web', 'unknown']);
  // Dublagem de BluRay: o BluRay primeiro
  assert.deepEqual(orderBySpeed(['web', 'bd'], v => fps[v], [ntsc]), ['bd']);
  // Velocidade das dublagens desconhecida: não decide, a ordem de qualidade fica
  assert.deepEqual(orderBySpeed(['bd', 'web'], v => fps[v], [undefined]), ['bd', 'web']);
});
