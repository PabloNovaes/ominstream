import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPortuguese, isDashManifest } from '../lib/verify/dash';

test('DASH: reconhece o manifesto pelo link e o português pelo idioma declarado', () => {
  assert.equal(isDashManifest('https://cdn.test/a/Dragon.Ball.Portuguese.1080p.mpd?x=1'), true);
  assert.equal(isDashManifest('https://cdn.test/a/file.mkv'), false);
  assert.equal(hasPortuguese(['jpn']), false); // o "Portuguese" do MovieBox
  assert.equal(hasPortuguese(['jpn', 'por']), true);
  assert.equal(hasPortuguese(['pt-BR']), true);
});
