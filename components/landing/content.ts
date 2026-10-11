/** Textos e dados da página inicial. Os números vêm dos testes reais do OminStream. */

export const STATS = [
  { value: '9', label: 'fontes agregadas' },
  { value: '~256 KB', label: 'lidos por arquivo' },
  { value: '< 1 s', label: 'por verificação' },
  { value: '4K + FHD', label: 'vagas por resolução' },
];

export const STEPS = [
  {
    n: '01',
    title: 'Agrega',
    text: 'Consulta todas as suas fontes em paralelo e junta o mesmo release vindo de lugares diferentes.',
  },
  {
    n: '02',
    title: 'Filtra o cache',
    text: 'Confere no TorBox o que já está em cache. Só entra o que toca na hora, sem espera.',
  },
  {
    n: '03',
    title: 'Verifica o áudio',
    text: 'Lê as faixas direto no arquivo via HTTP Range e confirma a dublagem PT-BR pela etiqueta de idioma.',
  },
  {
    n: '04',
    title: 'Entrega o melhor',
    text: 'Ordena por resolução, Dolby Vision, HDR e remux, com vagas para 4K e Full HD.',
  },
];

export const TRACKS = [
  { ok: true, lang: 'pt-BR', name: 'Portuguese (Brazil)', codec: 'E-AC3 5.1' },
  { ok: false, lang: 'rus', name: 'Dub [MovieDalen]', codec: 'E-AC3' },
  { ok: false, lang: 'ukr', name: 'Dub [Le Doyen]', codec: 'E-AC3' },
  { ok: false, lang: 'en-US', name: 'English (United States)', codec: 'E-AC3 5.1' },
];

export const SIGNALS = [
  { ok: true, text: 'Dublado' },
  { ok: true, text: 'DUAL' },
  { ok: true, text: '🇧🇷 Português' },
  { ok: false, text: 'Rus.Dub' },
  { ok: false, text: 'ENG.LATINO' },
  { ok: false, text: 'MULTi.VFF' },
  { ok: false, text: 'Legendado' },
];

export const QUALITY = ['4K DV HDR10+', '4K REMUX', '4K HDR', '1080p DUAL', '1080p WEB-DL', '720p'];

export const FUNNEL = [
  { value: '701', label: 'streams recebidos' },
  { value: '301', label: 'em cache, sem duplicados' },
  { value: '7', label: 'com PT-BR, os melhores', highlight: true },
];

export const SOURCES = [
  'Torrentio',
  'Comet',
  'MediaFusion',
  'Brazuca Torrents',
  'Magneto',
  'FenixFlix',
  'FrostStream',
  'PenguPlay',
  'HdHub',
  'TorBox',
];

export const NAV = [
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#fontes', label: 'Fontes' },
  { href: '#instalar', label: 'Instalar' },
];
