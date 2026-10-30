import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRemovableAfterPlay } from '../lib/debrid/cleanup';

const now = Date.parse('2026-10-29T22:00:00Z');
const torrent = (id: number, hash: string, name: string, ageMin: number) =>
  ({ id, hash, name, download_finished: true, created_at: new Date(now - ageMin * 60_000).toISOString() });

test('depois do play: fica o que toca, os protegidos (hash e nome) e o que acabou de entrar; o resto sai', () => {
  const account = [
    torrent(1, 'AAA', 'Loki.S01E01.2160p.DSNP.WEB-DL.mkv', 30), // vídeo tocando
    torrent(2, 'bbb', 'Loki.S01E01.1080p.DUAL.COMANDO.mkv', 30), // áudio do par tocando
    torrent(3, '742451cd468db1a656ae09fb44e07eea27ca9c7b', 'CURSO DE MACRAMÊ - IALAI ART', 20000),
    torrent(4, 'ddd', 'Curso de Macrame parte 2', 20000), // só pelo nome
    torrent(5, 'eee', 'Friends S01-S10', 3), // busca em andamento
    torrent(6, 'fff', 'Westworld.S01E01.2160p.mkv', 60),
    torrent(7, 'ggg', 'Dormindo.com.o.Inimigo.1991.mkv', 5000),
    { ...torrent(8, 'hhh', 'Sem data', 60), created_at: undefined },
  ];
  const { remove, kept } = pickRemovableAfterPlay(account, {
    playing: ['aaa', 'BBB'],
    protectedHashes: new Set(['742451cd468db1a656ae09fb44e07eea27ca9c7b']),
    now,
  });
  assert.deepEqual(remove.map(t => t.id), [6, 7]);
  assert.deepEqual(kept.map(k => k.reason), ['tocando', 'tocando', 'protegido', 'protegido pelo nome', 'adicionado agora há pouco', 'sem data de criação']);
});
