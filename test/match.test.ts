import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesEpisode, matchesSeriesTitle } from '../lib/match';

const TWD = ['The Walking Dead', 'Os Mortos-Vivos'];

// Nomes reais devolvidos pelas fontes para "The Walking Dead S01E01"
test('spin-offs NÃO são The Walking Dead', () => {
  for (const name of [
    'The.Walking.Dead.Dead.City.S01E01.1080p.WEB-DL.DUBLADO.mp4',
    'COMANDO.TO - The.Walking.Dead.World.Beyond.S01e01.1080p.WEB-DL.DUAL.mkv',
    'The.Walking.Dead.The.Ones.Who.Live.S01E01.Anos.1080p.WEB-DL.DUAL.5.1.mkv',
    '[COMANDO.LA]The.Walking.Dead.Daryl.Dixon.S01E01.1080p.WEB-DL.DUAL.5.1.mkv',
    'The Walking Dead - Dead City S01E01 WEB-DL 1080p x264 DUAL 5.1.mkv',
    'Fear The Walking Dead S01E01 1080p HDTV x264-RK - Dual Audio.mkv',
  ]) {
    assert.equal(matchesSeriesTitle(name, TWD), false, name);
  }
});

test('episódios da própria série são aceitos', () => {
  for (const name of [
    'The.Walking.Dead.S01E01.1080p.WEB-DL.DUAL.DDP2.0.H.264-ArtdEco.mkv',
    'The Walking Dead - S01E01 - Days Gone Bye - 1080p BluRay x264-Belex - Dual Audio.mkv',
    'The.Walking.Dead.2021.S01.E01.Russian.1080p.mp4',
    'The Walking Dead S11E24 (2021) 1080p WEB-DL [Dublado Portugues] MOSTBET.mkv',
    'The Walking Dead s05e01 Dual Áudio 720p - The Pirate Filmes.mp4',
    'The Walking Dead 05x01.mp4',
    'WWW.BLUDV.COM - The.Walking.Dead.S01E01.1080p.mkv',
  ]) {
    assert.equal(matchesSeriesTitle(name, TWD), true, name);
  }
});

test('nome sem título: não dá para saber (aceito)', () => {
  assert.equal(matchesSeriesTitle('1 - Days Gone Bye.mp4', TWD), null);
  assert.equal(matchesSeriesTitle('1x01 - -By JefePsb - WOLVERDONFILMES.COM.mkv', TWD), null);
  assert.equal(matchesSeriesTitle(undefined, TWD), null);
});

test('título alternativo (La Casa de Papel / Money Heist)', () => {
  const titles = ['Money Heist', 'La casa de papel'];
  assert.equal(matchesSeriesTitle('La.Casa.de.Papel.S01E01.1080p.DUAL.mkv', titles), true);
  assert.equal(matchesSeriesTitle('Money Heist S01E01 1080p.mkv', titles), true);
});

test('episódio no nome precisa bater', () => {
  assert.equal(matchesEpisode('The.Walking.Dead.S05E01.1080p.mkv', 5, 1), true);
  assert.equal(matchesEpisode('The.Walking.Dead.S05E02.1080p.mkv', 5, 1), false);
  assert.equal(matchesEpisode('The Walking Dead 05x01.mp4', 5, 1), true);
  assert.equal(matchesEpisode('The.Walking.Dead.S01.E01.mp4', 1, 1), true);
  assert.equal(matchesEpisode('Show.S01E01-E03.1080p.mkv', 1, 2), true); // pacote com intervalo
  assert.equal(matchesEpisode('The.Walking.Dead.Season.5.1080p', 5, 1), true); // pacote da temporada
  assert.equal(matchesEpisode(undefined, 5, 1), true);
});

// Glow Up (tt9680524): o TMDB escreve "Britain's"; os torrents, "Britains"; o PenguPlay, "Britain.s"
test("apóstrofo no título (Glow Up: Britain's Next Make-Up Star)", () => {
  const titles = ["Glow Up: Britain's Next Make-Up Star", 'Glow Up: Quem Vai Brilhar Mais?'];
  for (const name of [
    'Glow.Up-Britains.Next.Make.Up.Star.S01E01.1080p.NF.WEB-DL.DDP2.0.x264-TEPES.mkv',
    'Glow.Up.Britains.Next.Make-Up.Star.S01E01.MULTi.READNFO.1080p.WEB.h264-N3TFL1X[eztv.io].mkv',
    'Glow.Up.Britain.s.Next.Make-Up.Star.S01E01.1080p.NF.WEB-DL.DDP2.0.x264-TEPES.mkv',
    "Glow Up Britain's Next Make-Up Star S01E01 1080p.mkv",
  ]) {
    assert.equal(matchesSeriesTitle(name, titles), true, name);
  }
  assert.equal(matchesSeriesTitle('Glow.Up.Ireland.S01E01.1080p.HDTV.H264-DARKFLiX.mkv', titles), false);
  assert.equal(matchesSeriesTitle("Grey.s.Anatomy.S01E01.mkv", ["Grey's Anatomy"]), true);
  assert.equal(matchesSeriesTitle('Greys.Anatomy.S01E01.mkv', ["Grey's Anatomy"]), true);
});
