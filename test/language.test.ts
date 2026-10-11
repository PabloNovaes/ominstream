import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrack, scoreText, stripLanguageHints } from '../lib/verify/language';

// --- Faixas reais --------------------------------------------------------------------
test('faixa: "Dub" com etiqueta russa NÃO é português (captura do Nuvio)', () => {
  assert.equal(classifyTrack({ language: 'rus', name: 'Dub [MovieDalen]' }), 'other');
  assert.equal(classifyTrack({ language: 'ukr', name: 'Dub [Le Doyen]' }), 'other');
});
test('faixa: etiqueta pt-BR (Sobrenatural)', () => {
  assert.equal(classifyTrack({ language: 'por', languageBCP47: 'pt-BR', name: 'Portuguese (Brazil)' }), 'pt-br');
});
test('faixa: "por" com nome de Portugal vira PT-PT', () => {
  assert.equal(classifyTrack({ language: 'por', name: 'Português (Portugal)' }), 'pt-pt');
});
test('faixa: "por" genérico conta como PT-BR (configurável)', () => {
  assert.equal(classifyTrack({ language: 'por' }), 'pt-br');
  assert.equal(classifyTrack({ language: 'por' }, { acceptGenericPor: false }), 'unknown');
});
test('faixa: sem etiqueta, o nome decide', () => {
  assert.equal(classifyTrack({ name: 'Dublado' }), 'pt-br');
  assert.equal(classifyTrack({ language: 'und', name: 'PT-BR 5.1' }), 'pt-br');
  assert.equal(classifyTrack({ name: 'Dub' }), 'unknown');
});
test('faixa: inglês explícito', () => {
  assert.equal(classifyTrack({ language: 'eng', name: 'English' }), 'other');
});

// --- Textos reais dos addons ------------------------------------------------------------
const likely = (t: string) => scoreText(t).score >= 50;
test('texto: FrostStream "🌎 Português"', () => assert.ok(likely('🎬 Duna: Parte Dois\n🌊 Pure\n🌎 Português')));
test('texto: FenixFlix "🇧🇷 Dublado"', () => assert.ok(likely('🐦‍🔥 Duna: Parte Dois\n🇧🇷 Dublado\n⭐️ Hollymovies')));
test('texto: release BR com DUAL (Sobrenatural)', () =>
  assert.ok(likely('Sobrenatural - Agora Entre Nós 2026 WEB-DL 2160p x265 DV HDR10+ DUAL 5.1')));
test('texto: Comando com DUAL', () => assert.ok(likely('Comando.LA - Duna - Parte Dois 2024 1080p FULL HD WEB-DL DUAL 5.1.mkv')));

const unlikely = (t: string) => scoreText(t).score < 50;
test('texto: "Rus.Dub" NÃO é dublado em português', () =>
  assert.ok(unlikely('Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR.H.265.DDP5.1.Atmos.Rus.Dub.5.1.Gavrilla.mkv')));
test('texto: "Dual Audio [Hindi-English]"', () => assert.ok(unlikely('Movie.2024.1080p.WEB-DL.Dual.Audio.[Hindi-English].mkv')));
test('texto: ENG.LATINO', () =>
  assert.ok(unlikely('Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR10.PLUS.ENG.LATINO.DDP5.1.Atmos.H265.MKV-BEN.THE.MEN.mkv')));
test('texto: MediaFusion com lista sem português', () =>
  assert.ok(unlikely('🎨 DV|HDR 📺 BluRay REMUX\n📦 85.37 GB\n🌐 Czech + English + French + German + Italian + Japanese + Polish + Spanish')));
test('texto: Comet MULTi VFF com bandeira francesa', () =>
  assert.ok(unlikely('📄 Dune.Part.Two.2024.MULTi.VFF.2160p.UHD.BluRay.REMUX-OPTIMUM.mkv\n🌎/🇫🇷')));
test('texto: legendado', () => assert.ok(unlikely('Filme.2024.1080p.LEGENDADO.mkv')));
test('texto: release sem indício nenhum', () => assert.ok(unlikely('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX')));

test('Magneto: bandeiras sem critério são ignoradas', () => {
  const yts = 'Dune.Part.Two.2024.1080p.WEBRip.x264.AAC-[YTS.MX].mp4\n🇧🇷🇺🇸  ⚡ TorBox  💾 2.76 GB';
  assert.ok(likely(yts)); // com a bandeira, pareceria português
  assert.ok(unlikely(stripLanguageHints(yts))); // sem as bandeiras do Magneto, não há indício
});
test('grupo brasileiro configurado soma pontos', () => {
  assert.equal(scoreText('Filme.2024.1080p.MULTI-COMANDO', ['comando']).score, 45);
});
