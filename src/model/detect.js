import { fold } from './text.js';
import {
  FIRST_NAMES, HONORIFICS, STOP_WORDS, NOT_NAMES, CONNECTORS, ORG_CONNECTORS, ORG_PREFIXES
} from './lexicon.js';

const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
const NUMBER_LABEL = '(?:\\s*(?:No\\.?|N[°º]\\.?|núm(?:ero)?\\.?|#))?\\s*:?\\s*';
const SUFFIX = '(?:S\\.\\s?A\\.\\s?S\\.?|SAS|S\\.\\s?A\\.|S\\.\\s?en\\s+C\\.|S\\.\\s?C\\.\\s?A\\.|E\\.\\s?U\\.|E\\.S\\.P\\.|LTDA\\.?|Ltda\\.?)';
const COMPANY_SUFFIX = new RegExp('(?<![\\p{L}\\p{N}])' + SUFFIX + '(?![\\p{L}\\p{N}])', 'gu');
export const COMPANY_SUFFIX_AT_END = new RegExp('[\\s,]*' + SUFFIX + '\\s*$', 'u');

const PLATE_IGNORED = /^(NIT|ART|CRA|CLL|TEL|CEL|NUM|FOL|PAR|EST|SAS|CIA|COP|USD|IVA)\b/;

const RULES = [
  { type: 'CORREO', re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  { type: 'NIT', group: 1, re: new RegExp('\\bNIT\\.?' + NUMBER_LABEL + '(\\d{1,3}(?:\\.\\d{3}){1,2}(?:-\\d)?|\\d{8,10}(?:-\\d)?)', 'giu') },
  { type: 'CEDULA', group: 1, re: new RegExp('(?:\\bC\\.?\\s?C\\.?|\\bC\\.?\\s?E\\.?|\\bT\\.?\\s?I\\.?|\\bc[ée]dula(?:\\s+de\\s+(?:ciudadan[ií]a|extranjer[ií]a))?|\\bpasaporte|\\bidentificad[oa]\\s+con)' + NUMBER_LABEL + '(\\d{1,3}(?:\\.\\d{3}){1,3}(?!\\d)|\\d{6,10}(?!\\d))', 'giu') },
  { type: 'CUENTA', group: 1, re: new RegExp('(?:\\b[Cc]uenta(?:\\s+(?:de\\s+ahorros|corriente|bancaria|de\\s+n[oó]mina))?|\\b[Cc]ta\\.?(?:\\s+(?:cte|ahorros))?)(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2}' + NUMBER_LABEL + '(\\d[\\d-]{6,20}\\d)', 'gu') },
  { type: 'TELEFONO', group: 1, re: new RegExp('(?:\\b[Tt]el(?:[ée]fono)?|\\b[Cc]el(?:ular)?|\\b[Mm][oó]vil|\\b[Ww]hats[Aa]pp)\\.?\\s*:?\\s*(\\+?[\\d\\s()-]{7,18}\\d)', 'gu') },
  { type: 'RADICADO', re: /\b\d{23}\b/g },
  { type: 'RADICADO', re: /\b(?:19|20)\d{2}-\d{3,6}(?:-\d{2})?\b/g },
  { type: 'NIT', re: /\b\d{1,3}(?:\.\d{3}){2}-\d\b|\b\d{9,10}-\d\b/g },
  { type: 'DIRECCION', re: /\b(?:[Cc]alle|[Cc]arrera|[Aa]venida|[Dd]iagonal|[Tt]ransversal|[Cc]ircular|Av\.?|Cra\.?|Cr\.?|Cl\.?|Kr\.?|Kra\.?)\s+\d{1,3}[A-Za-z]?(?:\s+(?:[Bb]is|[Ss]ur|[Nn]orte|[Ee]ste|[Oo]este))?\s*(?:#|[Nn]o\.?|N[°º]\.?)\s*\d{1,3}[A-Za-z]?\s*[-–]\s*\d{1,3}(?:,\s*(?:[Bb]arrio|[Cc]onjunto|[Ee]dificio|[Uu]rbanizaci[oó]n|[Cc]onj\.?)\s+[A-ZÁÉÍÓÚÑ][\p{L}]*(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}]*){0,3})?/gu },
  { type: 'TELEFONO', re: /(?:\+?57[\s-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b|\(?\b60[1-8]\)?[\s-]?\d{3}[\s-]?\d{4}\b/g },
  { type: 'FECHA', re: new RegExp('\\b\\d{1,2}\\s+de\\s+(?:' + MONTHS + ')(?:\\s+(?:de|del)\\s+\\d{4})?', 'giu') },
  { type: 'FECHA', re: /\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b/g },
  { type: 'MONTO', re: /\$\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?(?:\s?(?:millones|mil)\b)?/gu },
  { type: 'MONTO', re: /\b\d{1,3}(?:[.,]\d{3})+\s*(?:pesos|COP|USD|dólares)\b/giu },
  { type: 'PLACA', re: /\b[A-Z]{3}[\s-]?\d{3}\b|\b[A-Z]{3}\d{2}[A-Z]\b/g, skip: (s) => PLATE_IGNORED.test(s) }
];

const isCapitalized = (w) => w[0] !== w[0].toLowerCase() && w[0] === w[0].toUpperCase();
const onlySpaces = /^\s+$/;

function makeClaims(length) {
  const taken = new Uint8Array(length);
  const found = [];
  return {
    found,
    isFree: (s, e) => { for (let k = s; k < e; k++) if (taken[k]) return false; return true; },
    claim(s, e, type) { taken.fill(1, s, e); found.push({ start: s, end: e, type }); }
  };
}

function detectByPattern(text, claims) {
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      if (!m[0].length) { rule.re.lastIndex++; continue; }
      const end = m.index + m[0].length;
      let start = m.index;
      if (rule.group) {
        if (!m[rule.group]) continue;
        start = end - m[rule.group].length;
      }
      if (rule.skip && rule.skip(m[0])) continue;
      if (claims.isFree(start, end)) claims.claim(start, end, rule.type);
    }
  }
}

function detectCompanies(text, claims) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ s: m.index, e: m.index + m[0].length, w: m[0] });
  COMPANY_SUFFIX.lastIndex = 0;
  while ((m = COMPANY_SUFFIX.exec(text))) {
    const suffixStart = m.index;
    const suffixEnd = m.index + m[0].length;
    const k = tokens.findIndex((t) => t.s <= suffixStart && suffixStart < t.e);
    if (k < 0) continue;
    let first = k;
    let count = 0;
    for (let j = k - 1; j >= 0 && count < 7; j--) {
      const w = tokens[j].w;
      if (j < k - 1 && /[,;:]$/.test(w)) break;
      const bare = w.replace(/^[("“]+/, '').replace(/,+$/, '');
      if (!bare) break;
      const ok = /^\p{Lu}/u.test(bare) || bare === '&' || ORG_CONNECTORS.has(fold(bare));
      if (!ok) break;
      first = j;
      count++;
    }
    while (first < k) {
      const word = fold(tokens[first].w.replace(/[^\p{L}&]/gu, ''));
      if (ORG_CONNECTORS.has(word) || STOP_WORDS.has(word)) first++;
      else break;
    }
    if (first === k) continue;
    const start = tokens[first].s + (/^[("“]/.test(tokens[first].w) ? 1 : 0);
    if (claims.isFree(start, suffixEnd)) claims.claim(start, suffixEnd, 'EMPRESA');
  }
}

function capitalizedRuns(text, words) {
  const runs = [];
  let i = 0;
  while (i < words.length) {
    if (!isCapitalized(words[i].w)) { i++; continue; }
    let j = i;
    for (;;) {
      if (j + 1 >= words.length) break;
      if (!onlySpaces.test(text.slice(words[j].e, words[j + 1].s))) break;
      if (isCapitalized(words[j + 1].w)) { j++; continue; }
      let k = j + 1;
      while (k < words.length && CONNECTORS.has(fold(words[k].w)) && onlySpaces.test(text.slice(words[k - 1].e, words[k].s))) k++;
      if (k > j + 1 && k < words.length && onlySpaces.test(text.slice(words[k - 1].e, words[k].s)) && isCapitalized(words[k].w)) { j = k; continue; }
      break;
    }
    runs.push([i, j]);
    i = j + 1;
  }
  return runs;
}

function detectPeopleAndPrefixedOrgs(text, claims) {
  const words = [];
  const re = /[\p{L}][\p{L}'’-]*/gu;
  let m;
  while ((m = re.exec(text))) words.push({ s: m.index, e: m.index + m[0].length, w: m[0] });

  for (const [runStart, runEnd] of capitalizedRuns(text, words)) {
    let a = runStart;
    let b = runEnd;
    let honorific = false;

    if (ORG_PREFIXES.has(fold(words[a].w)) && b - a >= 1) {
      let last = b;
      for (let x = a + 1; x <= b; x++) {
        if (STOP_WORDS.has(fold(words[x].w))) { last = x - 1; break; }
      }
      while (last > a && CONNECTORS.has(fold(words[last].w))) last--;
      if (last > a && claims.isFree(words[a].s, words[last].e)) {
        claims.claim(words[a].s, words[last].e, 'EMPRESA');
        continue;
      }
    }

    while (a <= b && HONORIFICS.has(fold(words[a].w))) { honorific = true; a++; }
    if (!honorific && a > 0 && a === runStart) {
      const prev = words[a - 1];
      if (HONORIFICS.has(fold(prev.w)) && /^\.?\s+$/.test(text.slice(prev.e, words[a].s))) honorific = true;
    }
    while (a <= b && STOP_WORDS.has(fold(words[a].w))) a++;
    if (a > b) continue;
    if (!honorific) {
      while (a <= b && !FIRST_NAMES.has(fold(words[a].w))) a++;
      if (a > b) continue;
    }
    let cut = b;
    for (let y = a + 1; y <= b; y++) {
      if (STOP_WORDS.has(fold(words[y].w))) { cut = y - 1; break; }
    }
    b = cut;
    while (b >= a && CONNECTORS.has(fold(words[b].w))) b--;
    if (b < a) continue;
    const firstWord = fold(words[a].w);
    const count = b - a + 1;
    const isName = (FIRST_NAMES.has(firstWord) && (count >= 2 || honorific)) || (honorific && !NOT_NAMES.has(firstWord));
    if (isName && claims.isFree(words[a].s, words[b].e)) claims.claim(words[a].s, words[b].e, 'PERSONA');
  }
}

export function detect(text) {
  const claims = makeClaims(text.length);
  detectByPattern(text, claims);
  detectCompanies(text, claims);
  detectPeopleAndPrefixedOrgs(text, claims);
  return claims.found.sort((p, q) => p.start - q.start);
}
