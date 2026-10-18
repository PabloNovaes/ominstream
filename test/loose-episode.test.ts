import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesLooseEpisode } from '../lib/match';

// Nomes do TMDB (trecho) de Os Simpsons
const EPISODES = [
  { season: 1, episode: 1, names: ['Natal Sangrento', 'Simpsons Roasting on an Open Fire'] },
  { season: 1, episode: 2, names: ['Bart, o Gênio', 'Bart the Genius'] },
  { season: 6, episode: 1, names: ['O Circo de Lembranças de Monty Burns', 'Bart of Darkness'] },
  { season: 7, episode: 1, names: ['O Falcão e o Trapalhão', 'Who Shot Mr. Burns? (Part Two)'] },
];

test('número certo, mas título de outro episódio: fora (o caso dos Simpsons T1E1)', () => {
  assert.equal(matchesLooseEpisode('Episódio 01 - O Circo de Lembranças de Monty Burns.mp4', 1, 1, EPISODES), false);
  assert.equal(matchesLooseEpisode('1 - O Falcão e o Trapalhão.mp4', 1, 1, EPISODES), false);
});

test('título do episódio pedido: fica', () => {
  assert.equal(matchesLooseEpisode('01 - Natal Sangrento.mp4', 1, 1, EPISODES), true);
  assert.equal(matchesLooseEpisode('Episode 1 - Simpsons Roasting on an Open Fire 1080p.mkv', 1, 1, EPISODES), true);
});

test('número de outro episódio: fora', () => {
  assert.equal(matchesLooseEpisode('02 - Bart, o Gênio.mp4', 1, 1, EPISODES), false);
});

test('sem como saber (título desconhecido ou sem número): fica', () => {
  assert.equal(matchesLooseEpisode('01 - Uma Tradução Diferente.mp4', 1, 1, EPISODES), true);
  assert.equal(matchesLooseEpisode('Os Simpsons Temporada 1 Completa.mkv', 1, 1, EPISODES), true);
});

test('com S01E01 no nome a decisão é do matchesEpisode', () => {
  assert.equal(matchesLooseEpisode('The.Simpsons.S01E01.1080p.mkv', 1, 1, EPISODES), true);
});

// Textos reais do Torrentio para Os Simpsons T1E1
test('pacote de outra temporada: fora', () => {
  assert.equal(matchesLooseEpisode('Episódio 01 - O Circo de Lembranças de Monty Burns.mp4', 1, 1, [],
    '1080p | Os Simpsons - Temporada 28 (WEB-DL 1080p Dual Áudio)\nEpisódio 01 - O Circo de Lembranças de Monty Burns.mp4'), false);
  assert.equal(matchesLooseEpisode('1 - O Falcão e o Trapalhão.mp4', 1, 1, [],
    '720p | Os Simpsons 23 Temporada 720p dublado - FB\n1 - O Falcão e o Trapalhão.mp4'), false);
});

test('pacote da temporada pedida, ou com várias temporadas: decide pelo resto', () => {
  assert.equal(matchesLooseEpisode('01 - Qualquer.mp4', 1, 1, [], 'Os Simpsons 1ª Temporada Dublado'), true);
  assert.equal(matchesLooseEpisode('01 - Qualquer.mp4', 1, 1, [], 'I Simpson Stagioni 1 - 36 (1989-2024)'), true);
});
