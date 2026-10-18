import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTheaterRecording } from '../lib/release';

test('gravações de cinema são reconhecidas', () => {
  for (const name of [
    'The.Odyssey.2026.CAM.x264-GRP.mkv',
    'Movie 2026 HDCAM 720p Dublado',
    'Movie.2026.HD-CAM.c1nem4.mp4',
    'Filme.2026.CAMRip.XviD.avi',
    'Movie.2026.HQCAM.1080p',
    'Movie.2026.TELESYNC.x264',
    'Movie 2026 HDTS 1080p',
    'Movie.2026.HD-TS.x264',
    'Movie.2026.TELECINE.avi',
    '📹 CAM | 🇧🇷 Dublado',
    '[CAM] Movie (2026)',
  ]) {
    assert.ok(isTheaterRecording(name), name);
  }
});

test('releases normais não são confundidos com CAM', () => {
  for (const name of [
    'Inside Out (2015) 2160p BluRay x265 HDR (Tigole).mkv',
    'Movie.2026.1080p.WEB-DL.DUAL.DDP5.1.mkv',
    'Coraline.2009.1080p.AMZN.WEB-DL.H.264-FF.mkv',
    'American.Made.2017.1080p.BluRay.mkv', // "Ame-ri-CAn"
    'Camera.Obscura.2024.1080p.WEB-DL.mkv', // "Cam" dentro de outra palavra
    'Scam.2025.2160p.WEB-DL.mkv',
    'Movie.2026.1080p.WEB.h264.ts', // extensão .ts
    'Movie 2026 TS Dublado', // "TS" solto fica de fora de propósito
  ]) {
    assert.equal(isTheaterRecording(name), false, name);
  }
});

import { parseAudioBadges, parseSource } from '../lib/release';

test('selos de áudio', () => {
  assert.deepEqual(parseAudioBadges('Coraline.2009.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.REMUX-FraMeSToR.mkv'), ['DOLBY ATMOS', 'TRUEHD', '7.1']);
  assert.deepEqual(parseAudioBadges('Coraline.2009.1080p.AMZN.WEB-DL.DDP5.1.H.264.DUAL-FF.mkv'), ['DOLBY DIGITAL+', '5.1']);
  assert.deepEqual(parseAudioBadges('Coraline.2009.German.US.UHDBD.2160p.DV.HDR10.HEVC.DTSHD.DL.Remux-pmHD.mkv'), ['DTS-HD MA']);
  assert.deepEqual(parseAudioBadges('Movie 2020 2160p DTS-X 7.1'), ['DTS:X', '7.1']);
  assert.deepEqual(parseAudioBadges('Coraline BluRay 1080p (Dual Áudio) 5.1 WWW.TORRENTDOSFILMES.COM.mp4'), ['5.1']);
  assert.deepEqual(parseAudioBadges('Movie.2021.1080p.WEB.h264.AC3.mkv'), ['DOLBY DIGITAL']);
  assert.deepEqual(parseAudioBadges('Movie.2021.1080p.WEB-DL.x264'), []);
});

test('origem da imagem', () => {
  assert.equal(parseSource('Coraline.2009.German.US.UHDBD.2160p.DV.HDR10.HEVC.DTSHD.DL.Remux-pmHD.mkv'), 'REMUX');
  assert.equal(parseSource('Movie 2020 1080p BluRay x264'), 'BLU-RAY');
  assert.equal(parseSource('Movie.2020.1080p.AMZN.WEB-DL.DDP5.1'), 'WEB-DL');
  assert.equal(parseSource('Movie.2020.720p.WEBRip.x264'), 'WEBRIP');
  assert.equal(parseSource('Movie 2020 1080p Dublado'), undefined);
});
