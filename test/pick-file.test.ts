import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFile } from '../lib/play';

// Pacote da 1ª temporada de Os Simpsons; ids do TorBox fora da ordem dos episódios
const pack = {
  files: [
    { id: 0, name: 'Os Simpsons T01/The.Simpsons.S01E03.DUAL.mkv', size: 300 },
    { id: 1, name: 'Os Simpsons T01/The.Simpsons.S01E01.DUAL.mkv', size: 310 },
    { id: 2, name: 'Os Simpsons T01/The.Simpsons.S01E02.DUAL.mkv', size: 305 },
    { id: 3, name: 'Os Simpsons T01/sample.mkv', size: 5 },
  ],
};

test('pacote: escolhe pelo episódio pedido, não pelo índice da fonte', () => {
  // A fonte disse índice 0 (que no TorBox é o E03)
  assert.equal(pickFile(pack, { t: 'series', id: 'tt0096697:1:1', i: 0 }), 1);
  assert.equal(pickFile(pack, { t: 'series', id: 'tt0096697:1:2', i: 0 }), 2);
});

test('nome exato da fonte de outro episódio não vence o episódio pedido', () => {
  assert.equal(pickFile(pack, { t: 'series', id: 'tt0096697:1:1', f: 'The.Simpsons.S01E03.DUAL.mkv' }), 1);
});

test('arquivos sem marca: usa o número no início', () => {
  const plain = { files: [
    { id: 7, name: 'T1/02 - Bart, o Gênio.mkv', size: 1 },
    { id: 8, name: 'T1/01 - Natal Sangrento.mkv', size: 1 },
  ] };
  assert.equal(pickFile(plain, { t: 'series', id: 'tt0096697:1:1' }), 8);
});

test('filme com um vídeo continua igual', () => {
  assert.equal(pickFile({ files: [{ id: 4, name: 'Filme.2024.mkv', size: 9 }] }, { t: 'movie', id: 'tt1' }), 4);
});

test('índice da fonte que aponta para outro episódio é recusado', () => {
  const noMatch = { files: [
    { id: 0, name: 'The.Simpsons.S01E03.mkv', size: 1 },
    { id: 1, name: 'The.Simpsons.S01E04.mkv', size: 1 },
  ] };
  assert.equal(pickFile(noMatch, { t: 'series', id: 'tt0096697:1:1', i: 0 }), null);
});
