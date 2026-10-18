import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRemovable, type AccountSnapshot } from '../lib/debrid/cleanup';
import type { AccountTorrent } from '../lib/debrid/torbox';

const START = Date.parse('2026-10-15T20:00:00Z');
const MACRAME = '742451cd468db1a656ae09fb44e07eea27ca9c7b';

const torrent = (id: number, hash: string, createdAt: string, name = `t${id}`): AccountTorrent => ({
  id,
  hash,
  name,
  download_finished: true,
  created_at: createdAt,
});

const macrame = torrent(115854312, MACRAME, '2026-10-10T21:09:40Z', 'CURSO DE MACRAMÊ - IALAI ART Por Laiz Alionço');
const snapshot: AccountSnapshot = { ids: new Set([macrame.id]), hashes: new Set([MACRAME]) };
const fresh = torrent(2, 'aaaa', '2026-10-15T20:00:05Z');

const decide = (account: AccountTorrent[], probed: string[], extra: Partial<Parameters<typeof pickRemovable>[1]> = {}) =>
  pickRemovable(account, {
    snapshot,
    probedHashes: probed,
    listedHashes: [],
    protectedHashes: new Set([MACRAME]),
    sessionStart: START,
    ...extra,
  });

test('apaga só o torrent adicionado nesta busca e fora da lista', () => {
  const { remove } = decide([macrame, fresh], ['AAAA']);
  assert.deepEqual(remove.map(t => t.id), [2]);
});

test('o curso de macramê nunca sai, por nenhum caminho', () => {
  // Já estava na conta
  assert.equal(decide([macrame], [MACRAME]).remove.length, 0);
  // Mesmo sem a foto saber dele e com data "nova": está na lista de protegidos
  const disguised = { ...macrame, created_at: '2026-10-15T20:00:05Z' };
  const noShot = { ids: new Set<number>(), hashes: new Set<string>() };
  assert.equal(decide([disguised], [MACRAME], { snapshot: noShot }).remove.length, 0);
  // Mesmo sem estar na lista de protegidos: estava na foto
  assert.equal(decide([disguised], [MACRAME], { protectedHashes: new Set() }).remove.length, 0);
});

test('o que está na lista de opções fica (o autoplay pode estar tocando)', () => {
  assert.equal(decide([fresh], ['aaaa'], { listedHashes: ['AAAA'] }).remove.length, 0);
});

test('pedido de /play durante a busca segura o torrent', () => {
  assert.equal(decide([fresh], ['aaaa'], { playedSince: h => h === 'aaaa' }).remove.length, 0);
});

test('torrent antigo, sem data ou duplicado não sai', () => {
  const old = torrent(3, 'bbbb', '2026-10-01T10:00:00Z');
  const noDate = { ...torrent(4, 'cccc', ''), created_at: undefined };
  const dupA = torrent(5, 'dddd', '2026-10-15T20:00:05Z');
  const dupB = torrent(6, 'dddd', '2026-10-15T20:00:06Z');
  const { remove, kept } = decide([old, noDate, dupA, dupB], ['bbbb', 'cccc', 'dddd']);
  assert.equal(remove.length, 0);
  assert.deepEqual(kept.map(k => k.reason).sort(), ['criado antes desta busca', 'mais de um torrent com esse hash', 'sem data de criação'].sort());
});

test('id que já estava na foto não sai, mesmo com hash novo', () => {
  const reused = torrent(115854312, 'eeee', '2026-10-15T20:00:05Z');
  assert.equal(decide([reused], ['eeee']).remove.length, 0);
});

test('hash que não foi lido nesta busca nunca é considerado', () => {
  assert.equal(decide([macrame, fresh], []).remove.length, 0);
});
