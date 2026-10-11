import { readMkvTracks, type MkvTrack, type ProbeStats } from './mkv';
import { readMp4Tracks } from './mp4';
import { classifyTrack, type TrackVerdict } from './language';

export type AudioCheck = {
  verdict: 'pt-br' | 'pt-pt' | 'no-pt';
  audio: { language?: string; name?: string; verdict: TrackVerdict }[];
  stats: ProbeStats;
};

/**
 * Lê as faixas de um vídeo remoto (MKV ou MP4) só com HTTP Range.
 * Usa a extensão do nome do arquivo quando conhecida; senão tenta MKV e depois MP4.
 */
export async function readTracks(url: string, filename?: string): Promise<{ tracks: MkvTrack[]; stats: ProbeStats }> {
  if (filename && /\.(mp4|m4v|mov)$/i.test(filename)) return readMp4Tracks(url);
  if (filename && /\.mkv$/i.test(filename)) return readMkvTracks(url);
  try {
    return await readMkvTracks(url);
  } catch (err) {
    if (err instanceof Error && /Matroska/.test(err.message)) return readMp4Tracks(url);
    throw err;
  }
}

/** Verificação definitiva: o arquivo tem áudio em PT-BR? */
export async function checkAudio(
  url: string,
  { filename, acceptGenericPor = true, acceptPtPt = false }: { filename?: string; acceptGenericPor?: boolean; acceptPtPt?: boolean } = {},
): Promise<AudioCheck> {
  const { tracks, stats } = await readTracks(url, filename);
  const audio = tracks
    .filter(t => t.type === 'audio')
    .map(t => ({
      language: t.languageBCP47 ?? t.language,
      name: t.name,
      verdict: classifyTrack(t, { acceptGenericPor }),
    }));

  const verdict = audio.some(a => a.verdict === 'pt-br')
    ? 'pt-br'
    : acceptPtPt && audio.some(a => a.verdict === 'pt-pt')
      ? 'pt-pt'
      : 'no-pt';
  return { verdict, audio, stats };
}
