/**
 * Leitor mínimo de faixas de MP4/MOV (ISO BMFF) via HTTP Range, sem ffprobe.
 *
 * O índice (moov) pode estar no início (faststart) ou no fim, depois dos dados (mdat).
 * Lemos o início; se o moov não estiver lá, saltamos de caixa em caixa pelo cabeçalho
 * até encontrá-lo, baixando só os cabeçalhos e o próprio moov.
 */
import type { MkvTrack, ProbeStats } from './mkv';

type Box = { type: string; start: number; headerSize: number; size: number };

const HANDLER_TYPE: Record<string, MkvTrack['type']> = { vide: 'video', soun: 'audio', sbtl: 'subtitle', subt: 'subtitle', text: 'subtitle' };

async function fetchRange(url: string, start: number, end: number, stats: ProbeStats, timeoutMs: number) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status !== 206) throw new Error(`servidor não aceitou Range (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  stats.requests++;
  stats.bytes += buf.length;
  const total = Number(res.headers.get('content-range')?.split('/')[1]) || undefined;
  return { buf, total };
}

/** Lê o cabeçalho de uma caixa (size 1 = tamanho de 64 bits; size 0 = até o fim do arquivo). */
function readBoxHeader(buf: Buffer, pos: number, fileOffset: number, fileSize?: number): Box | null {
  if (pos + 8 > buf.length) return null;
  let size = buf.readUInt32BE(pos);
  const type = buf.toString('latin1', pos + 4, pos + 8);
  let headerSize = 8;
  if (size === 1) {
    if (pos + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(pos + 8));
    headerSize = 16;
  } else if (size === 0) {
    if (!fileSize) return null;
    size = fileSize - (fileOffset + pos);
  }
  if (size < headerSize) return null;
  return { type, start: fileOffset + pos, headerSize, size };
}

/** Filhos de uma caixa contêiner (dados já em memória, relativos ao início de `buf`). */
function children(buf: Buffer, start: number, end: number): (Box & { at: number })[] {
  const out: (Box & { at: number })[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const box = readBoxHeader(buf, pos, 0);
    if (!box || pos + box.size > end) break;
    out.push({ ...box, at: pos });
    pos += box.size;
  }
  return out;
}

const child = (buf: Buffer, parent: { at: number; headerSize: number; size: number }, type: string, skip = 0) =>
  children(buf, parent.at + parent.headerSize + skip, parent.at + parent.size).find(b => b.type === type);

/** Idioma do mdhd: 3 letras ISO-639-2 compactadas em 15 bits. */
function mdhdLanguage(buf: Buffer, mdhd: { at: number; headerSize: number }): string | undefined {
  const body = mdhd.at + mdhd.headerSize;
  const version = buf[body];
  const langPos = body + 4 + (version === 1 ? 8 + 8 + 4 + 8 : 4 + 4 + 4 + 4);
  const packed = buf.readUInt16BE(langPos) & 0x7fff;
  if (!packed) return undefined;
  const lang = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
  return /^[a-z]{3}$/.test(lang) ? lang : undefined;
}

const cString = (buf: Buffer, start: number, end: number) => {
  const zero = buf.indexOf(0, start);
  return buf.toString('utf8', start, zero >= 0 && zero < end ? zero : end).trim();
};

/** Duração do filme em segundos (mvhd: escala de tempo + duração, em 32 ou 64 bits conforme a versão). */
function mvhdDuration(buf: Buffer, moov: { at: number; headerSize: number; size: number }): number | undefined {
  const mvhd = child(buf, moov, 'mvhd');
  if (!mvhd) return undefined;
  const body = mvhd.at + mvhd.headerSize;
  const v1 = buf[body] === 1;
  const timescale = buf.readUInt32BE(body + 4 + (v1 ? 16 : 8));
  const duration = v1 ? Number(buf.readBigUInt64BE(body + 4 + 20)) : buf.readUInt32BE(body + 4 + 12);
  return timescale && duration ? duration / timescale : undefined;
}

function parseMoov(buf: Buffer, moov: { at: number; headerSize: number; size: number }): MkvTrack[] {
  const tracks: MkvTrack[] = [];
  const traks = children(buf, moov.at + moov.headerSize, moov.at + moov.size).filter(b => b.type === 'trak');

  traks.forEach((trak, i) => {
    const t: MkvTrack = { number: i + 1 };
    const mdia = child(buf, trak, 'mdia');
    if (mdia) {
      const mdhd = child(buf, mdia, 'mdhd');
      if (mdhd) {
        const lang = mdhdLanguage(buf, mdhd);
        if (lang && lang !== 'und') t.language = lang;
      }
      const hdlr = child(buf, mdia, 'hdlr');
      if (hdlr) {
        const body = hdlr.at + hdlr.headerSize;
        const handler = buf.toString('latin1', body + 8, body + 12);
        t.type = HANDLER_TYPE[handler] ?? undefined;
        const handlerName = cString(buf, body + 24, hdlr.at + hdlr.size);
        // Nomes genéricos de ferramentas não identificam a faixa
        if (handlerName && !/^(sound|video|subtitle|text)?\s*handler$|^core media|^isomedia|^l-smash|^gpac/i.test(handlerName)) {
          t.name = handlerName;
        }
      }
      const elng = child(buf, mdia, 'elng'); // idioma estendido (BCP 47, ex.: "pt-BR")
      if (elng) t.languageBCP47 = cString(buf, elng.at + elng.headerSize + 4, elng.at + elng.size) || undefined;

      const stsd = (() => {
        const minf = child(buf, mdia, 'minf');
        const stbl = minf && child(buf, minf, 'stbl');
        return stbl && child(buf, stbl, 'stsd');
      })();
      if (stsd) {
        // stsd: versão/flags (4) + quantidade (4) + primeira entrada (tamanho + codec)
        const entry = stsd.at + stsd.headerSize + 8;
        if (entry + 8 <= stsd.at + stsd.size) {
          t.codec = buf.toString('latin1', entry + 4, entry + 8);
          if (t.type === 'audio' && entry + 26 <= buf.length) t.channels = buf.readUInt16BE(entry + 8 + 16);
          if (t.type === 'video' && entry + 36 <= buf.length) {
            t.width = buf.readUInt16BE(entry + 8 + 24);
            t.height = buf.readUInt16BE(entry + 8 + 26);
          }
        }
      }
    }
    // Título da faixa gravado em udta/name (ex.: ffmpeg -metadata:s:a title=...)
    const udta = child(buf, trak, 'udta');
    const name = udta && child(buf, udta, 'name');
    if (name) t.name = cString(buf, name.at + name.headerSize, name.at + name.size) || t.name;
    tracks.push(t);
  });
  return tracks;
}

export async function readMp4Tracks(
  url: string,
  { initialBytes = 256 * 1024, timeoutMs = 15_000, maxHops = 12 } = {},
): Promise<{ tracks: MkvTrack[]; durationSec?: number; stats: ProbeStats }> {
  const stats: ProbeStats = { requests: 0, bytes: 0 };
  const { buf: head, total } = await fetchRange(url, 0, initialBytes - 1, stats, timeoutMs);
  if (head.toString('latin1', 4, 8) !== 'ftyp') throw new Error('não é um arquivo MP4/MOV');

  let offset = 0; // posição no arquivo
  for (let hop = 0; hop < maxHops; hop++) {
    // Cabeçalho da caixa atual: do bloco inicial, ou buscando 16 bytes nessa posição
    let box: Box | null;
    if (offset + 16 <= head.length) box = readBoxHeader(head, offset, 0, total);
    else {
      if (total && offset >= total) break;
      const { buf } = await fetchRange(url, offset, offset + 15, stats, timeoutMs);
      box = readBoxHeader(buf, 0, offset, total);
    }
    if (!box) break;

    if (box.type === 'moov') {
      const moov =
        box.start + box.size <= head.length
          ? head
          : (await fetchRange(url, box.start, box.start + box.size - 1, stats, timeoutMs)).buf;
      const at = moov === head ? box.start : 0;
      const moovBox = { at, headerSize: box.headerSize, size: box.size };
      return { tracks: parseMoov(moov, moovBox), durationSec: mvhdDuration(moov, moovBox), stats };
    }
    offset = box.start + box.size; // pula ftyp, free, mdat... sem baixá-los
  }
  throw new Error('caixa moov não encontrada');
}
