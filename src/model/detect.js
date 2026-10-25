import { fold } from './text.js';
import { SCORES, THRESHOLD, nitCheckDigitOk } from './scores.js';
import { detectProperNouns } from './properNouns.js';
import { detectAddresses } from './addresses.js';
import { detectCaselessNames, detectUpperNames, CUE_BEFORE } from './caselessNames.js';
import {
  FIRST_NAMES, HONORIFICS, STOP_WORDS, NOT_NAMES, CONNECTORS, ORG_CONNECTORS, ORG_PREFIXES, ROLE_WORDS, SURNAMES, COMMON_CAPS,
  INSTITUTION_WORDS, PLACES, NAME_CUES, SENTENCE_STARTERS, COMMON_LOWER_NAMES
} from './lexicon.js';

const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
// «No.», «Nro.», «N°», «N 1.234.567», «número», «#», con «-» antes («CC - No. 71234567») y «:» opcional.
const NUMBER_LABEL = '(?:\\s*[-–]\\s*)?(?:\\s*(?:No\\.?|Nro\\.?|N[°º]\\.?|N(?=\\s*\\d)|núm(?:ero)?\\.?|#))?\\s*:?\\s*';
const SUFFIX = '(?:S\\.\\s?A\\.\\s?S\\.?|SAS|S\\.\\s?A\\.|S\\.\\s?en\\s+C\\.|S\\.\\s?C\\.\\s?A\\.|E\\.\\s?U\\.|E\\.S\\.P\\.|LTDA\\.?|Ltda\\.?)';
const COMPANY_SUFFIX = new RegExp('(?<![\\p{L}\\p{N}])' + SUFFIX + '(?![\\p{L}\\p{N}])', 'gu');
export const COMPANY_SUFFIX_AT_END = new RegExp('[\\s,]*' + SUFFIX + '\\s*$', 'u');

const PLATE_IGNORED = /^(NIT|ART|CRA|CLL|TEL|CEL|NUM|FOL|PAR|EST|SAS|CIA|COP|USD|IVA)\b/;

const RULES = [
  { type: 'CORREO', score: SCORES.cue, re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  { type: 'NIT', score: SCORES.cue, group: 1, re: new RegExp('\\bNIT\\.?' + NUMBER_LABEL + '(\\d{1,3}(?:\\.\\d{3}){1,2}(?:-\\d)?|\\d{8,10}(?:-\\d)?)', 'giu') },
  { type: 'CEDULA', score: SCORES.cue, group: 1, re: new RegExp('(?:\\bC\\.?\\s?C\\.?|\\bC\\.?\\s?E\\.?|\\bT\\.?\\s?I\\.?|\\bc[ée]dula(?:\\s+de\\s+(?:ciudadan[ií]?a|extranjer[ií]a))?|\\bpasaporte|\\bidentificad[oa]\\s+con)' + NUMBER_LABEL + '(\\d{1,3}(?:\\.\\d{3}){1,3}(?!\\d)|\\d{1,3}(?:,\\d{3}){2,3}(?!\\d|,\\d)|\\d{6,10}(?!\\d))', 'giu') },
  { type: 'CUENTA', score: SCORES.cue, group: 1, re: new RegExp('(?:\\b[Cc]uenta(?:\\s+(?:de\\s+ahorros|corriente|bancaria|de\\s+n[oó]mina))?|\\b[Cc]ta\\.?(?:\\s+(?:cte|ahorros))?)(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2}' + NUMBER_LABEL + '(\\d[\\d-]{6,20}\\d)', 'giu') },
  { type: 'TELEFONO', score: SCORES.cue, group: 1, re: new RegExp('(?:\\b[Tt]el(?:[ée]fono)?|\\b[Cc]el(?:ular)?|\\b[Mm][oó]vil|\\b[Ww]hats[Aa]pp)\\.?\\s*:?\\s*(\\+?[\\d\\s()-]{7,18}\\d)', 'gu') },
  { type: 'RADICADO', score: SCORES.bareNumber, re: /\b\d{23}\b/g },
  { type: 'RADICADO', score: SCORES.bareNumber, re: /\b(?:19|20)\d{2}-\d{3,6}(?:-\d{2})?\b/g },
  { type: 'NIT', score: (v) => (nitCheckDigitOk(v) === false ? SCORES.nitBadCheck : SCORES.nitChecked), re: /\b\d{1,3}(?:\.\d{3}){2}-\d\b|\b\d{9,10}-\d\b/g },
  // Las direcciones las marca detectAddresses (addresses.js), antes de estas reglas.
  { type: 'TELEFONO', score: SCORES.bareNumber, re: /(?:\+?57[\s-]?)?\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b|\(?\b60[1-8]\)?[\s-]?\d{3}[\s-]?\d{4}\b/g },
  { type: 'FECHA', score: SCORES.cue, re: new RegExp('\\b\\d{1,2}\\s+de\\s+(?:' + MONTHS + ')(?:\\s+(?:de|del)\\s+\\d{4})?', 'giu') },
  { type: 'FECHA', score: SCORES.cue, re: /\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b/g },
  { type: 'MONTO', score: SCORES.cue, re: /\$\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?(?:\s?(?:millones|mil)\b)?/gu },
  { type: 'MONTO', score: SCORES.cue, re: /\b\d{1,3}(?:[.,]\d{3})+\s*(?:pesos|COP|USD|dólares)\b/giu },
  { type: 'PLACA', score: SCORES.plate, re: /\b[A-Z]{3}[\s-]?\d{3}\b|\b[A-Z]{3}\d{2}[A-Z]\b/g, skip: (s) => PLATE_IGNORED.test(s) }
];

const isCapitalized = (w) => w[0] !== w[0].toLowerCase() && w[0] === w[0].toUpperCase();
const onlySpaces = /^\s+$/;

function makeClaims(length) {
  const taken = new Uint8Array(length);
  const found = [];
  return {
    found,
    isFree: (s, e) => { for (let k = s; k < e; k++) if (taken[k]) return false; return true; },
    claim(s, e, type, score) {
      taken.fill(1, s, e);
      found.push({ start: s, end: e, type, score, ...(score < THRESHOLD ? { weak: true } : {}) });
    }
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
      const score = typeof rule.score === 'function' ? rule.score(text.slice(start, end)) : rule.score;
      if (claims.isFree(start, end)) claims.claim(start, end, rule.type, score);
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
    if (claims.isFree(start, suffixEnd)) claims.claim(start, suffixEnd, 'EMPRESA', SCORES.company);
  }
}

const isNameWord = (f) => FIRST_NAMES.has(f) || SURNAMES.has(f);
const commonWord = (f) => STOP_WORDS.has(f) || COMMON_CAPS.has(f) || SENTENCE_STARTERS.has(f) || INSTITUTION_WORDS.has(f)
  || HONORIFICS.has(f) || ROLE_WORDS.has(f) || CONNECTORS.has(f) || NAME_CUES.has(f) || PLACES.has(f);
// Terminaciones de verbo o participio: «pagó», «firmando», «firmado», «recibió»… no son parte de un nombre.
const VERB_LIKE = /(?:[oó]|i[oó]|aba|aron|ando|iendo|endo|ado|ada|ido|ida|ar|er|ir|mente)$/u;

/**
 * ¿La palabra en minúscula que sigue (words[j + 1]) es parte del nombre que va en words[i..j]? Un nombre escrito a la
 * carrera deja palabras en minúscula: «Carlos andrés Mendoza Ríos», «Teodoro albán Rincón», «Mendoza ríos».
 */
function lowercaseNamePart(text, words, i, j) {
  const next = words[j + 1];
  if (!/^\p{Ll}/u.test(next.w)) return false;
  const f = fold(next.w);
  const all = words.slice(i, j + 1).map((w) => fold(w.w));
  // El nombre empieza en su primera palabra de nombre conocida o en la palabra con mayúscula justo antes de un nombre
  // de pila en minúscula («Yurani lorena …»); lo de antes («Luego», «Comparece») no cuenta.
  const firstKnown = all.findIndex(isNameWord);
  if (firstKnown < 0 && !(FIRST_NAMES.has(f) && all.length >= 1)) return false;
  const run = firstKnown < 0 ? all.slice(-1) : all.slice(firstKnown);
  if (run.filter((w) => !CONNECTORS.has(w)).length >= 5) return false;
  if (commonWord(f)) return false;
  // Nombre o apellido conocido que no es palabra común: «andrés», «lorena», «quintero», «gómez».
  if (isNameWord(f) && !COMMON_LOWER_NAMES.has(f)) return true;
  const after = words[j + 2];
  const spacedAfter = after && onlySpaces.test(text.slice(next.e, after.s));
  // Palabra desconocida entre un nombre y un apellido conocido con mayúscula: «Teodoro albán Rincón».
  if (!isNameWord(f) && spacedAfter && isCapitalized(after.w) && SURNAMES.has(fold(after.w)) && f.length >= 3 && !VERB_LIKE.test(f)) return true;
  // Apellido que también es palabra común, al final: «Carlos Mendoza ríos» (nombre + apellido + apellido).
  return COMMON_LOWER_NAMES.has(f) && SURNAMES.has(f) && SURNAMES.has(run[run.length - 1]) && run.some((w) => FIRST_NAMES.has(w))
    && run.length <= 3 && !(spacedAfter && (isCapitalized(after.w) || isNameWord(fold(after.w))));
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
      if (lowercaseNamePart(text, words, i, j)) { j++; continue; }
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

const surnameLike = (f) => SURNAMES.has(f) || !(FIRST_NAMES.has(f) || STOP_WORDS.has(f) || COMMON_CAPS.has(f) || INSTITUTION_WORDS.has(f)
  || HONORIFICS.has(f) || ROLE_WORDS.has(f) || NOT_NAMES.has(f) || PLACES.has(f) || NAME_CUES.has(f) || SENTENCE_STARTERS.has(f) || CONNECTORS.has(f));

/** Índice desde donde empiezan los apellidos escritos antes del nombre de pila (en words[a]); a si no hay. */
function surnamesBefore(words, a, runStart, b) {
  const lead = Math.max(runStart, a - 2);
  if (lead >= a) return a;
  // «Yurani lorena Paz Obando»: la palabra con mayúscula justo antes de un nombre de pila escrito en minúscula también
  // es un nombre de pila, aunque no esté en la lista.
  if (/^\p{Ll}/u.test(words[a].w) && isCapitalized(words[a - 1].w) && surnameLike(fold(words[a - 1].w))
    && !SURNAMES.has(fold(words[a - 1].w)) && !VERB_LIKE.test(fold(words[a - 1].w))) return a - 1;
  const before = words.slice(lead, a).map((w) => fold(w.w));
  if (!before.every(surnameLike)) return a;
  const onlyFirstNames = words.slice(a, b + 1).every((w) => FIRST_NAMES.has(fold(w.w)) || CONNECTORS.has(fold(w.w)));
  return before.some((f) => SURNAMES.has(f)) || onlyFirstNames ? lead : a;
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
        claims.claim(words[a].s, words[last].e, 'EMPRESA', SCORES.company);
        continue;
      }
    }

    // Los nombres en MAYÚSCULAS los busca detectCaselessNames con listas de apellidos: aquí darían falsos positivos («LUZ VERDE PARA…»).
    if (words.slice(a, b + 1).every((w) => w.w.length > 1 && w.w === w.w.toUpperCase())) continue;
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
      if (STOP_WORDS.has(fold(words[y].w)) || ROLE_WORDS.has(fold(words[y].w))) { cut = y - 1; break; }
    }
    b = cut;
    while (b >= a && CONNECTORS.has(fold(words[b].w))) b--;
    if (b < a) continue;
    const firstWord = fold(words[a].w);
    const count = b - a + 1;
    // Apellidos primero («Montenegro Ríos Lucía Fernanda», en listas y formularios): las 1 o 2 palabras de antes del nombre de pila
    // se suman si alguna es un apellido conocido o si después solo vienen nombres de pila.
    const lead = honorific ? a : surnamesBefore(words, a, runStart, b);
    const isName = (FIRST_NAMES.has(firstWord) && (count >= 2 || honorific || a - lead === 2)) || (honorific && !NOT_NAMES.has(firstWord));
    if (!isName) continue;
    // «fidel castro» sin ninguna mayúscula: lo decide detectCaselessNames (solo sugerencia si no hay pista).
    if (!honorific && lead === a && b - a === 1 && words.slice(a, b + 1).every((w) => /^\p{Ll}/u.test(w.w))) continue;
    if (lead < a && claims.isFree(words[lead].s, words[b].e)) a = lead;
    // «Firma: ana María Gómez»: un nombre de pila en minúscula con pista de contexto justo antes se suma al nombre con mayúsculas.
    if (lead === a && a > 0 && a === runStart && /^\p{Ll}/u.test(words[a - 1].w) && FIRST_NAMES.has(fold(words[a - 1].w))
      && onlySpaces.test(text.slice(words[a - 1].e, words[a].s)) && CUE_BEFORE.test(text.slice(Math.max(0, words[a - 1].s - 40), words[a - 1].s))
      && claims.isFree(words[a - 1].s, words[b].e)) a = a - 1;
    if (claims.isFree(words[a].s, words[b].e)) claims.claim(words[a].s, words[b].e, 'PERSONA', SCORES.person);
  }
}

/** Con `context` (de buildNameContext, todo el documento) también busca nombres propios y lugares. */
export function detect(text, context = null) {
  const claims = makeClaims(text.length);
  detectAddresses(text, claims);
  detectByPattern(text, claims);
  detectCompanies(text, claims);
  detectPeopleAndPrefixedOrgs(text, claims);
  for (const d of detectUpperNames(text, claims.isFree)) claims.claim(d.start, d.end, 'PERSONA', SCORES.upperName);
  for (const d of detectCaselessNames(text, claims.isFree)) claims.claim(d.start, d.end, 'PERSONA', d.weak ? SCORES.weak : SCORES.caselessName);
  if (context) {
    for (const d of detectProperNouns(text, claims.isFree, context)) {
      if (claims.isFree(d.start, d.end)) claims.claim(d.start, d.end, d.type, d.weak ? SCORES.weak : SCORES.properNoun);
    }
  }
  return claims.found.sort((p, q) => p.start - q.start);
}
