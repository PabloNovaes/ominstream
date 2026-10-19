import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchScore, titleMatch } from '../lib/catalog';

const rank = (items: Parameters<typeof searchScore>[0][], q: string) =>
  items
    .map(i => ({ i, s: searchScore(i, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.i.title ?? x.i.name);

test('"the walking dead": a série principal vem antes de títulos parecidos', () => {
  const items = [
    { id: 1, name: 'The Walking Dead: The Return', popularity: 3, vote_count: 10 },
    { id: 2, name: 'The Walking Dead', popularity: 180, vote_count: 17000 },
    { id: 3, name: 'The Walking Dead: Daryl Dixon', popularity: 90, vote_count: 900 },
  ];
  assert.equal(rank(items, 'the walking dead')[0], 'The Walking Dead');
});

test('"transformers": o filme de 2007 (exato e popular) vem primeiro', () => {
  const items = [
    { id: 1, title: 'Transformers: O Início', popularity: 60, vote_count: 900 },
    { id: 2, title: 'Transformers', popularity: 80, vote_count: 11000 },
    { id: 3, title: 'Transformers: A Era da Extinção', popularity: 40, vote_count: 9000 },
  ];
  assert.equal(rank(items, 'transformers')[0], 'Transformers');
});

test('"minions 2": o filme principal vem antes dos curtas', () => {
  const items = [
    { id: 1, title: 'Curtas dos Minions 2', popularity: 5, vote_count: 40 },
    { id: 2, title: 'Minions 2: A Origem de Gru', original_title: 'Minions: The Rise of Gru', popularity: 70, vote_count: 3500 },
  ];
  assert.equal(rank(items, 'minions 2')[0], 'Minions 2: A Origem de Gru');
});

test('título original também conta ("city of god" acha "Cidade de Deus")', () => {
  const items = [{ id: 1, title: 'Cidade de Deus', original_title: 'Cidade de Deus', popularity: 30, vote_count: 8000 }];
  assert.deepEqual(rank(items, 'cidade de deus'), ['Cidade de Deus']);
});

test('item popular SEM relação com o termo fica de fora', () => {
  const items = [
    { id: 1, title: 'Duna', popularity: 50, vote_count: 12000 },
    { id: 2, name: 'Assassinatos em Viena', popularity: 400, vote_count: 300 },
  ];
  assert.deepEqual(rank(items, 'duna'), ['Duna']);
});

test('busca mista: a série popular fica acima de filmes obscuros de título original idêntico', () => {
  const items = [
    { id: 1, title: 'O Morto Ambulante', original_title: 'The Walking Dead', popularity: 2, vote_count: 60 },
    { id: 2, title: 'Resgate no Vietnã', original_title: 'The Walking Dead', popularity: 3, vote_count: 70 },
    { id: 3, name: 'The Walking Dead', popularity: 180, vote_count: 17000 },
    { id: 4, name: 'The Walking Dead: Daryl Dixon', popularity: 90, vote_count: 900 },
  ];
  const order = rank(items, 'the walking dead');
  assert.equal(order[0], 'The Walking Dead');
  assert.ok(order.indexOf('The Walking Dead: Daryl Dixon') < order.indexOf('O Morto Ambulante'));
});

test('"e", "and" e "&" valem o mesmo e palavras de ligação não são exigidas', () => {
  const titles = ['Velozes & Furiosos 7', '+ Velozes + Furiosos', 'Velozes e Furiosos 4', 'Velozes & Furiosos: Hobbs & Shaw'];
  for (const title of titles) {
    assert.ok(titleMatch({ id: 1, title }, 'velozes e furiosos') >= 45, title);
  }
  assert.equal(titleMatch({ id: 2, title: 'Tom e Jerry: Velozes e Ferozes' }, 'velozes e furiosos'), 0);
});

test('"+" vale "mais" e as palavras podem vir do título em português e do original juntos', () => {
  const second = { id: 584, title: '+ Velozes + Furiosos', original_title: '2 Fast 2 Furious' };
  assert.ok(titleMatch(second, 'mais velozes mais furiosos') >= 60);
  assert.ok(titleMatch(second, 'velozes e furiosos 2') > 0);
  assert.ok(titleMatch(second, '2 fast 2 furious') >= 60);
  assert.equal(titleMatch({ id: 9799, title: 'Velozes e Furiosos', original_title: 'The Fast and the Furious' }, 'velozes e furiosos 2'), 0);
});
