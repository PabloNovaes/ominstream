/**
 * Leitor mínimo de faixas de MKV (Matroska/EBML) via HTTP Range, sem ffprobe.
 * Lê só o necessário: o início do arquivo e, se preciso, o trecho do bloco Tracks
 * apontado pelo SeekHead. Validado contra o ffprobe com arquivos 4K reais do TorBox.
 */

export type MkvTrack = {
  number?: number;
  type?: 'video' | 'audio' | 'subtitle' | number;
  codec?: string;
  /** ausente quando a faixa não tem etiqueta (o padrão do Matroska seria "eng", mas na prática significa "não informado") */
  language?: string;
  languageBCP47?: string;
  name?: string;
  default?: boolean;
  forced?: boolean;
  channels?: number;
  width?: number;
  height?: number;
};

export type ProbeStats = { requests: number; bytes: number };
type El = { id: number; size: number | null; dataStart: number; end: number | null };
type SizedEl = El & { size: number; end: number };

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Tracks: 0x1654ae6b,
  Cluster: 0x1f43b675,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  Name: 0x536e,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  Channels: 0x9f,
};
const TRACK_TYPE: Record<number, MkvTrack['type']> = { 1: 'video', 2: 'audio', 17: 'subtitle' };

/** Lê um inteiro de tamanho variável (EBML). keepMarker=true para IDs. */
function readVint(buf: Buffer, pos: number, keepMarker: boolean) {
  const first = buf[pos];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || pos + len > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

function readElement(buf: Buffer, pos: number): El | null {
  const id = readVint(buf, pos, true);
  if (!id) return null;
  const size = readVint(buf, pos + id.len, false);
  if (!size) return null;
  const dataStart = pos + id.len + size.len;
  return { id: id.value, size: size.unknown ? null : size.value, dataStart, end: size.unknown ? null : dataStart + size.value };
}

function children(buf: Buffer, start: number, end: number): SizedEl[] {
  const out: SizedEl[] = [];
  let pos = start;
  while (pos < end) {
    const el = readElement(buf, pos);
    if (!el || el.end === null || el.end > buf.length) break;
    out.push(el as SizedEl);
    pos = el.end;
  }
  return out;
}

const uint = (buf: Buffer, el: SizedEl) => { let v = 0; for (let i = el.dataStart; i < el.end; i++) v = v * 256 + buf[i]; return v; };
const str = (buf: Buffer, el: SizedEl) => buf.toString('utf8', el.dataStart, el.end).replace(/\0+$/, '');

function parseTracks(buf: Buffer, start: number, end: number): MkvTrack[] {
  return children(buf, start, end)
    .filter(el => el.id === ID.TrackEntry)
    .map(entry => {
      const t: MkvTrack = {};
      for (const el of children(buf, entry.dataStart, entry.end)) {
        if (el.id === ID.TrackNumber) t.number = uint(buf, el);
        else if (el.id === ID.TrackType) t.type = TRACK_TYPE[uint(buf, el)] ?? uint(buf, el);
        else if (el.id === ID.CodecID) t.codec = str(buf, el);
        else if (el.id === ID.Language) t.language = str(buf, el);
        else if (el.id === ID.LanguageBCP47) t.languageBCP47 = str(buf, el);
        else if (el.id === ID.Name) t.name = str(buf, el);
        else if (el.id === ID.FlagDefault) t.default = uint(buf, el) === 1;
        else if (el.id === ID.FlagForced) t.forced = uint(buf, el) === 1;
        else if (el.id === ID.Audio) for (const a of children(buf, el.dataStart, el.end)) { if (a.id === ID.Channels) t.channels = uint(buf, a); }
        else if (el.id === ID.Video) for (const v of children(buf, el.dataStart, el.end)) {
          if (v.id === ID.PixelWidth) t.width = uint(buf, v);
          if (v.id === ID.PixelHeight) t.height = uint(buf, v);
        }
      }
      return t;
    });
}

/** Busca um intervalo de bytes. Conta o total baixado em `stats`. */
async function fetchRange(url: string, start: number, end: number, stats: ProbeStats, timeoutMs: number) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status !== 206) throw new Error(`servidor não aceitou Range (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  stats.requests++;
  stats.bytes += buf.length;
  return buf;
}

export async function readMkvTracks(
  url: string,
  { initialBytes = 256 * 1024, timeoutMs = 15_000 } = {},
): Promise<{ tracks: MkvTrack[]; stats: ProbeStats }> {
  const stats: ProbeStats = { requests: 0, bytes: 0 };
  const head = await fetchRange(url, 0, initialBytes - 1, stats, timeoutMs);

  const ebml = readElement(head, 0);
  if (!ebml || ebml.id !== ID.EBML || ebml.end === null) throw new Error('não é um arquivo Matroska/MKV');
  const segment = readElement(head, ebml.end);
  if (!segment || segment.id !== ID.Segment) throw new Error('Segment não encontrado');
  const segStart = segment.dataStart;

  // Percorre os filhos do Segment no trecho inicial: acha Tracks direto ou o SeekHead
  let tracksPos: number | null = null;
  let pos = segStart;
  while (pos < head.length) {
    const el = readElement(head, pos);
    if (!el || el.size === null || el.end === null) break;
    if (el.id === ID.Tracks) { tracksPos = pos; break; }
    if (el.id === ID.SeekHead && el.end <= head.length) {
      for (const seek of children(head, el.dataStart, el.end).filter(s => s.id === ID.Seek)) {
        const parts = children(head, seek.dataStart, seek.end);
        const sid = parts.find(p => p.id === ID.SeekID);
        const spos = parts.find(p => p.id === ID.SeekPosition);
        if (sid && spos && uint(head, sid) === ID.Tracks) tracksPos = segStart + uint(head, spos);
      }
      if (tracksPos !== null) break;
    }
    if (el.id === ID.Cluster) break; // começou o vídeo em si: não há Tracks antes daqui
    pos = el.end;
  }
  if (tracksPos === null) throw new Error('bloco Tracks não localizado');

  // Garante o bloco Tracks inteiro em memória (busca o trecho exato se estiver fora do início)
  let buf = head;
  let tracksEl = tracksPos + 16 <= head.length ? readElement(head, tracksPos) : null;
  if (!tracksEl || tracksEl.end === null || tracksEl.end > head.length) {
    const headerBytes = await fetchRange(url, tracksPos, tracksPos + 15, stats, timeoutMs);
    const hdr = readElement(headerBytes, 0);
    if (!hdr || hdr.end === null) throw new Error('cabeçalho do bloco Tracks inválido');
    buf = await fetchRange(url, tracksPos, tracksPos + hdr.end - 1, stats, timeoutMs);
    tracksEl = readElement(buf, 0);
  }
  if (!tracksEl || tracksEl.end === null) throw new Error('bloco Tracks inválido');

  return { tracks: parseTracks(buf, tracksEl.dataStart, tracksEl.end), stats };
}
