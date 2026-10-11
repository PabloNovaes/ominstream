/**
 * Classificação de idioma do áudio, em dois níveis:
 *
 * 1) classifyTrack: faixa real lida do arquivo (verificação definitiva).
 *    A ETIQUETA de idioma manda; o nome da faixa só é usado quando não há etiqueta.
 *    Ex.: "Dub [MovieDalen]" com idioma "rus" é dublagem RUSSA, não português.
 *
 * 2) scoreText: indícios no nome do release e no texto dos addons (sem abrir o arquivo).
 *    "Dub" sozinho não conta; "DUAL" é anulado por outros idiomas explícitos.
 */

export type TrackVerdict = 'pt-br' | 'pt-pt' | 'other' | 'unknown';

export type TrackInput = { language?: string; languageBCP47?: string; name?: string };

const PORTUGAL_RE = /portugal|europe|european|europeu|pt-pt|ptpt|\bpt\s*\(pt\)/i;
const PT_NAME_RE = /portugu[eê]s|portuguese|brasil|brazil|pt-?br|\bdublad[oa]\b|\bdublagem\b/i;
const UNTAGGED = new Set(['', 'und', 'mul', 'zxx', 'mis', 'unk']);

export function classifyTrack(track: TrackInput, { acceptGenericPor = true } = {}): TrackVerdict {
  const lang = (track.languageBCP47 || track.language || '').trim().toLowerCase();
  const name = track.name ?? '';

  if (!UNTAGGED.has(lang)) {
    if (lang === 'pt-br') return 'pt-br';
    if (lang === 'pt-pt') return 'pt-pt';
    if (/^(por|pt)(-|$)/.test(lang)) {
      if (PORTUGAL_RE.test(name)) return 'pt-pt';
      return acceptGenericPor || /brasil|brazil|pt-?br/i.test(name) ? 'pt-br' : 'unknown';
    }
    return 'other'; // idioma definido e diferente de português: o nome não muda isso
  }

  // Sem etiqueta: o nome da faixa é o único indício
  if (PT_NAME_RE.test(name)) return PORTUGAL_RE.test(name) ? 'pt-pt' : 'pt-br';
  return 'unknown';
}

export type TextScore = { score: number; signals: string[] };

// --- Indícios no texto ---------------------------------------------------------------
const STRONG_PT = /\bdublad[oa]s?\b|\bdublagem\b|\bnacional\b|\bpt[-. ]?br\b|portugu[eê]s|\bportuguese\b|\bbrazilian\b|🇧🇷/i;
const DUAL = /\bdual\b|\bdual[ .-]?audio\b/i;
const MULTI = /\bmulti(?:[ .-]?audio)?\b/i;
const LEGENDADO = /\blegendad[oa]\b|\bleg\b/i;
// Idiomas explícitos que indicam que DUAL/MULTI se refere a outra combinação
const OTHER_LANGS =
  /\b(rus|russian|ukr|ukrainian|hin|hindi|tam|tamil|tel|telugu|kan|kannada|mal|malayalam|latino|lat|castellano|spa|esp|spanish|ita|italian|ger|german|deu|fre|french|vff|vf2|vfq|vfi|truefrench|pol|polish|cze|czech|tur|turkish|kor|korean|jpn|japanese|chi|chinese|ara|arabic)\b/i;
const OTHER_DUB = /\b(rus|ukr|hin|hindi|lat|latino|ita|ger|fre|spa)[ .-]?dub\b/i;
// Bandeiras (pares de "regional indicators"): a lista de idiomas mostrada pelos addons
const FLAG_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
// Listas explícitas de idiomas (MediaFusion "🌐 English + French", FrostStream "🌎 Português")
const LANG_LIST_RE = /(?:🌐|🌎|🗣️?|🔊)\s*([^\n]+)/gu;

export function scoreText(text: string, brGroups: string[] = []): TextScore {
  const signals: string[] = [];
  let score = 0;
  const add = (pts: number, why: string) => {
    score += pts;
    signals.push(`${pts > 0 ? '+' : ''}${pts} ${why}`);
  };

  const strongPt = STRONG_PT.test(text);
  const otherLang = OTHER_LANGS.test(text) || OTHER_DUB.test(text);

  if (strongPt) add(70, 'português declarado');
  if (DUAL.test(text)) {
    if (otherLang && !strongPt) add(0, 'DUAL anulado: outro idioma explícito');
    else add(50, 'DUAL');
  } else if (MULTI.test(text) && !otherLang) {
    add(25, 'MULTI');
  }

  // Listas de idioma mostradas pelos addons
  const flags: string[] = text.match(FLAG_RE) ?? [];
  if (flags.length && !flags.includes('🇧🇷') && !flags.includes('🇵🇹')) add(-60, `bandeiras sem português (${[...new Set(flags)].join('')})`);
  for (const [, list] of text.matchAll(LANG_LIST_RE)) {
    const hasLetters = /\p{L}{3,}/u.test(list);
    if (hasLetters && !/portugu|brazil|brasil/i.test(list) && /english|french|spanish|german|italian|russian|czech|polish|japanese|hindi|ingl[eê]s/i.test(list)) {
      add(-60, 'lista de idiomas sem português');
      break;
    }
  }

  if (LEGENDADO.test(text)) add(-50, 'legendado');
  if (OTHER_DUB.test(text) && !strongPt) add(-30, 'dublagem em outro idioma');

  const lower = text.toLowerCase();
  const group = brGroups.find(g => g && lower.includes(g));
  if (group) add(20, `grupo/site brasileiro (${group})`);

  return { score: Math.max(0, Math.min(100, score)), signals };
}

/** Remove bandeiras e listas de idioma do texto de fontes que as exibem sem critério. */
export const stripLanguageHints = (text: string) => text.replace(FLAG_RE, '').replace(LANG_LIST_RE, '');
