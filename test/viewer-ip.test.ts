import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerIp } from '../lib/http';

const req = (xff?: string) => new Request('http://x/', { headers: xff ? { 'x-forwarded-for': xff } : {} });

test('IP local NÃO vai para o TorBox (faria ele escolher o CDN da Europa)', () => {
  for (const ip of ['::ffff:192.168.15.5', '192.168.15.5', '10.0.0.2', '172.20.1.1', '127.0.0.1', '::1', 'fd12:3456::1', 'fe80::1', '100.64.0.1', '100.127.255.1']) {
    assert.equal(viewerIp(req(ip)), undefined, ip);
  }
});

test('IP público é repassado (primeiro da lista do proxy)', () => {
  assert.equal(viewerIp(req('201.27.143.175')), '201.27.143.175');
  assert.equal(viewerIp(req('201.27.143.175, 76.76.21.21')), '201.27.143.175');
  assert.equal(viewerIp(req('::ffff:201.27.143.175')), '201.27.143.175');
  assert.equal(viewerIp(req('2804:14c:65a1::1')), '2804:14c:65a1::1');
  assert.equal(viewerIp(req('100.128.0.1')), '100.128.0.1'); // fora da faixa CGNAT
});

test('sem cabeçalho', () => assert.equal(viewerIp(req()), undefined));
