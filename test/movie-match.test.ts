import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesMovieTitle } from '../lib/match';
import { isAmbiguousPortuguese, scoreText } from '../lib/verify/language';

const up = ['Up', 'Up - Altas Aventuras', 'Oben', 'Là-haut'];
const interstellar = ['Interstellar', 'Interestelar'];
const coraline = ['Coraline', 'Coraline e o Mundo Secreto', 'Los mundos de Coraline', 'Coraline e la porta magica'];

test('arquivos do filme pedido passam', () => {
  for (const [name, titles] of [
    ['Up.2009.PORTUGUESE.720p.BRRip.x264-nTHD.mp4', up],
    ['Up - Altas Aventuras [2009]-BluRay 1080p Dual Áudio.mkv', up],
    ['Up (2009) 2160p H265 10 bit DV HDR10+ ita eng AC3 5.1 sub ita eng Licdom.mkv', up],
    ['Interstelar.2014.1080p.60fps.BluRay.H264.AC3.5.1.DUAL-RICKSZ.mkv', interstellar], // grafia errada
    ['Interstellar.2014.2160p.IMAX.BluRay.DTS-HDMA5.1.HDR.H265-WiKi.DUAL-andrehsa.mkv', interstellar],
    ['WWW.BLUDV.COM - Interestelar 2014 720p BluRay Dual.mkv', interstellar],
    ['Los mundos de Coraline (2009) [UHDRemux 2160p HEVC DV-HDR10].mkv', coraline],
    ['Coraline e o Mundo Secreto [2009] - BluRay 1080p Dual Áudio.mkv', coraline],
    ['InterstellarM1080.www.newpct1.com.mkv', interstellar],
  ] as const) {
    assert.equal(matchesMovieTitle(name, [...titles]), true, name);
  }
});

test('arquivos de outros filmes são descartados', () => {
  assert.equal(matchesMovieTitle('LUPIN.THE.IIIRD.The.Movie.The.Immortal.Bloodline.2025.1080p.mkv', up), false);
  assert.equal(matchesMovieTitle('Upgrade.2018.1080p.BluRay.x264.mkv', up), false);
  assert.equal(matchesMovieTitle('The.Calling.S01E02.2160p.WEB.mkv', interstellar), false);
});

test('sem nome legível ou sem títulos: não dá para saber', () => {
  assert.equal(matchesMovieTitle('Интерстеллар.2014.UHD.Blu-Ray.Remux.2160p.mkv', interstellar), null);
  assert.equal(matchesMovieTitle('1080pHLSH.2646Mbps1080phlsh.2646mbps.pad-Cinejoy', interstellar), null);
  assert.equal(matchesMovieTitle('AutoHLSautohls.pad-Cinejoy', up), null);
  assert.equal(matchesMovieTitle(undefined, up), null);
  assert.equal(matchesMovieTitle('2009.1080p.mkv', up), null);
  assert.equal(matchesMovieTitle('Up.2009.1080p.mkv', []), null);
});

test('português de Portugal declarado não conta como PT-BR', () => {
  for (const text of ['Movie.2009.PT-PT.1080p.mkv', 'Movie 2009 1080p 🇵🇹', 'Movie.2009.Portuguese.Portugal.720p']) {
    assert.ok(scoreText(text).score < 50, text);
  }
  assert.ok(scoreText('Movie.2009.PT-BR.1080p 🇵🇹🇧🇷').score >= 50);
});

test('"Portuguese" sozinho é ambíguo; com sinal do Brasil, não', () => {
  assert.equal(isAmbiguousPortuguese('Up.2009.PORTUGUESE.720p.BRRip.x264-nTHD.mp4'), true);
  assert.equal(isAmbiguousPortuguese('Up.2009.Dual.Audio.1080p.BluRay.x264-B.mkv'), false);
  assert.equal(isAmbiguousPortuguese('Movie 2009 Portuguese Dublado 1080p'), false);
  assert.equal(isAmbiguousPortuguese('Movie 2009 1080p 🇧🇷 Português'), false);
});

test('continuações não passam como o filme pedido', () => {
  // "Toy Story: Lá Ele" é um título alternativo real do TMDB (casava pela palavra "story")
  const toyStory = ['Toy Story', 'Toy Story: Um Mundo de Aventuras', 'Toy Story: Lá Ele'];
  assert.equal(matchesMovieTitle('Toy Story 2 1080p Dublado ramonTPB.mp4', toyStory), false);
  assert.equal(matchesMovieTitle('Toy.Story.II.1999.1080p.BluRay.mkv', toyStory), false);
  assert.equal(matchesMovieTitle('Toy Story Parte 3 2010 720p.mkv', toyStory), false);
  assert.equal(matchesMovieTitle('Toy Story 1080p Dublado ramonTPB.mp4', toyStory), true);
  assert.equal(matchesMovieTitle('Toy Story (1995) 1080p - 210GJI.mp4', toyStory), true);
  // Pedindo a continuação, ela passa
  assert.equal(matchesMovieTitle('Toy Story 2 1080p Dublado ramonTPB.mp4', ['Toy Story 2']), true);
});

const fastFurious = ['The Fast and the Furious', 'Velozes & Furiosos', 'Velozes e Furiosos', 'A Todo Gas'];
const fastContext = {
  year: 2001,
  siblings: [
    'The Fast and the Furious: Tokyo Drift', 'Velozes e Furiosos: Desafio em Tóquio',
    'Furious 7', 'Velozes e Furiosos 7', '2 Fast 2 Furious', '+Velozes +Furiosos',
  ],
};

test('Velozes e Furiosos 1: continuações e outros anos ficam de fora', () => {
  for (const name of [
    'The.Fast.and.the.Furious.Tokyo.Drift.2006.2160p.UHD.BluRay.x265.Dual Audio 5.1 Encoder by CARLOS JOSÉ WWW.BLUDV.TV.mkv',
    'Velozes and Furiosos 7 (2015) 1080p Dublado BRSHARES.mkv',
    'Velozes e Furiosos 7 1080p Dublado.mkv',
    'The.Fast.and.the.Furious.2009.1080p.mkv',
  ]) {
    assert.equal(matchesMovieTitle(name, fastFurious, fastContext), false, name);
  }
  for (const name of [
    'The.Fast.and.the.Furious.2001.Portuguese.1080p.mp4',
    'Velozes & Furiosos 1 (www.ThePirateFilmes.com) ToTTi9.mp4',
    'Velozes.e.Furiosos.2002.1080p.Dublado.mkv',
  ]) {
    assert.equal(matchesMovieTitle(name, fastFurious, fastContext), true, name);
  }
});

test('o filme da coleção com título mais longo continua aceito', () => {
  const tokyo = ['The Fast and the Furious: Tokyo Drift', 'Velozes e Furiosos: Desafio em Tóquio'];
  const ctx = { year: 2006, siblings: ['The Fast and the Furious', 'Velozes & Furiosos'] };
  assert.equal(
    matchesMovieTitle('The.Fast.and.the.Furious.Tokyo.Drift.2006.2160p.UHD.BluRay.x265.mkv', tokyo, ctx),
    true,
  );
});

test('ano que faz parte do título não conta como ano do arquivo', () => {
  assert.equal(matchesMovieTitle('Blade.Runner.2049.2017.2160p.mkv', ['Blade Runner 2049'], { year: 2017 }), true);
});
