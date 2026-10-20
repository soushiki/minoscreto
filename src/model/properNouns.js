// Nombres propios que no son personas ni empresas: proyectos, edificios, fincas, marcas, conjuntos…
// Usa todo el documento para decidir: una palabra con mayúscula que en otro lugar aparece en minúscula es común.
import { fold } from './text.js';
import {
  STOP_WORDS, HONORIFICS, NAME_CUES, INSTITUTION_WORDS, COMMON_CAPS, SENTENCE_STARTERS, PLACES
} from './lexicon.js';

// Dentro de un nombre: «Mirador del Río», «Finca La Esperanza». La «y» no: «Ecopetrol y la Hacienda» son dos nombres.
const CONNECTORS = new Set(['de', 'del', 'la', 'las', 'los']);
const ARTICLES = new Set(['el', 'la', 'los', 'las']);

const WORD_RE = /[\p{L}][\p{L}'’-]*/gu;
const ROMAN = /^[IVXLCDM]+$/;
const NAMING_CUE = /(?:denominad[oa]s?|llamad[oa]s?|conocid[oa]s?\s+como|bajo\s+el\s+nombre\s+de|con\s+el\s+nombre\s+de|nombre\s+comercial)\s*[:«"“'‘]?\s*$/iu;
// Lugares pequeños: «vereda El Retiro», «municipio de La Calera», «barrio San Diego».
const PLACE_CUE = /(?:^|\s)(?:vereda|corregimiento|municipio|barrio|sector|localidad|inspecci[oó]n|caser[ií]o|poblaci[oó]n)\s+(?:de\s+|del\s+)?$/iu;
const OPEN_QUOTE = /[«"“'‘]\s*$/u;
const CLOSE_QUOTE = /^\s*[»"”'’]/u;
const NOT_A_NAME_ENDING = /(?:mente|ndo|ados?|adas?|idos?|idas?)$/u;
const COMMON_NOUN_ENDING = /(?:cion|ciones|sion|siones|dad|dades|miento|mientos|ante|antes|ente|entes|ias|ista|istas|ivo|iva|ura|uras|ismo|ario|aria|orio|oria|ancia|encia|al|ales)$/u;

const isUpperWord = (w) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
const startsLower = (w) => w[0] !== w[0].toUpperCase();
const isCapitalized = (w) => !startsLower(w) && w[0] !== w[0].toLowerCase();

/** Contexto del documento: palabras que aparecen en minúscula y cuántas veces aparece cada una con mayúscula. */
export function buildNameContext(texts) {
  const lower = new Set();
  const caps = new Map();
  for (const text of texts) {
    for (const m of text.matchAll(WORD_RE)) {
      const f = fold(m[0]);
      if (startsLower(m[0])) lower.add(f);
      else caps.set(f, (caps.get(f) || 0) + 1);
    }
  }
  return { lower, caps };
}

/** ¿La palabra empieza una frase (inicio, después de . : ; ? ! o de una viñeta como «1.» o «a)»)? */
function sentenceInitial(text, start) {
  let i = start - 1;
  while (i >= 0 && /[\s«"“'‘(¿¡[—–-]/u.test(text[i])) i--;
  if (i < 0) return true;
  if (/[.:;?!…•]/u.test(text[i])) return true;
  return text[i] === ')' && /(?:^|\s)(?:\d{1,3}|\p{L})\)$/u.test(text.slice(Math.max(0, i - 4), i + 1));
}

/** Runs of capitalized words joined by spaces or by name connectors (de, del, la…): «Mirador del Río». */
function capitalizedRuns(text, words) {
  const runs = [];
  let i = 0;
  const spaced = (a, b) => /^\s+$/.test(text.slice(words[a].e, words[b].s));
  while (i < words.length) {
    if (!isCapitalized(words[i].w)) { i++; continue; }
    let j = i;
    for (;;) {
      if (j + 1 >= words.length || !spaced(j, j + 1)) break;
      if (isCapitalized(words[j + 1].w)) { j++; continue; }
      let k = j + 1;
      while (k < words.length && CONNECTORS.has(words[k].f) && spaced(k - 1, k)) k++;
      if (k > j + 1 && k < words.length && spaced(k - 1, k) && isCapitalized(words[k].w)) { j = k; continue; }
      break;
    }
    runs.push([i, j]);
    i = j + 1;
  }
  return runs;
}

const generic = (f, ctx) => ctx.lower.has(f) || COMMON_CAPS.has(f) || STOP_WORDS.has(f) || SENTENCE_STARTERS.has(f) || HONORIFICS.has(f);

/**
 * Busca nombres propios en un párrafo, en lo que no reclamó otro tipo. Devuelve [{ start, end, type, weak }]:
 * type 'NOMBRE' o 'LUGAR' (países y ciudades); weak = señal débil (solo se sugiere, no se activa).
 */
export function detectProperNouns(text, isFree, ctx) {
  const words = [];
  for (const m of text.matchAll(WORD_RE)) words.push({ s: m.index, e: m.index + m[0].length, w: m[0], f: fold(m[0]) });
  const found = [];
  const abbreviation = (w) => text[w.e] === '.' && w.w.length <= 4;

  const consider = (a, b) => {
    const initial = sentenceInitial(text, words[a].s);
    // Instituciones y normas («Juzgado Tercero Civil», «Código General del Proceso», «ley Anti…»): no son datos.
    if (INSTITUTION_WORDS.has(words[a].f)) return;
    const prev = words[a - 1];
    if (prev && startsLower(prev.w) && INSTITUTION_WORDS.has(prev.f) && /^\s+$/.test(text.slice(prev.e, words[a].s))) return;

    const runBefore = text.slice(Math.max(0, words[a].s - 40), words[a].s);
    let x = a;
    let cueInside = false;
    for (; x <= b; x++) {
      const w = words[x];
      if (PLACES.has(w.f)) break;
      if (NAME_CUES.has(w.f) && !isUpperWord(w.w) && x < b) { cueInside = true; break; }
      const strip = isUpperWord(w.w) || ROMAN.test(w.w) || w.w.length < 2 || abbreviation(w) || CONNECTORS.has(w.f)
        || STOP_WORDS.has(w.f) || HONORIFICS.has(w.f) || COMMON_CAPS.has(w.f)
        || (x === a && initial && (SENTENCE_STARTERS.has(w.f) || ctx.lower.has(w.f)));
      if (!strip) break;
    }
    // El artículo con mayúscula a mitad de frase es parte del nombre: «vereda El Retiro», «municipio de La Calera».
    if (x > a && ARTICLES.has(words[x - 1].f) && isCapitalized(words[x - 1].w) && !isUpperWord(words[x - 1].w) && !(initial && x - 1 === a)) x--;
    let y = b;
    while (y >= x && !PLACES.has(words[y].f) && (CONNECTORS.has(words[y].f) || isUpperWord(words[y].w) || ROMAN.test(words[y].w)
      || words[y].w.length < 2 || abbreviation(words[y]) || STOP_WORDS.has(words[y].f) || COMMON_CAPS.has(words[y].f))) y--;
    if (y < x || INSTITUTION_WORDS.has(words[x].f)) return;

    const content = words.slice(x, y + 1).filter((w) => !CONNECTORS.has(w.f));
    const start = words[x].s;
    const end = words[y].e;
    if (content.every((w) => isUpperWord(w.w))) return;

    if (content.every((w) => PLACES.has(w.f))) {
      found.push({ start, end, type: 'LUGAR', weak: false });
      return;
    }

    const before = text.slice(Math.max(0, start - 40), start);
    const cueBefore = (k) => k >= 0 && NAME_CUES.has(words[k].f) && /^[\s«"“'‘]*$/u.test(text.slice(words[k].e, words[k + 1].s));
    const cue = cueInside || cueBefore(x - 1) || cueBefore(a - 1) || NAMING_CUE.test(before) || NAMING_CUE.test(runBefore)
      || PLACE_CUE.test(runBefore);
    const quoted = OPEN_QUOTE.test(before) && CLOSE_QUOTE.test(text.slice(end, end + 3));
    const named = content.filter((w) => !NAME_CUES.has(w.f));
    if (!named.length) return;
    const distinctive = named.filter((w) => !generic(w.f, ctx));
    if (!cue && !quoted && !distinctive.length) return;
    if ((cue || quoted) && named.every((w) => COMMON_CAPS.has(w.f) || STOP_WORDS.has(w.f))) return;

    // Una sola palabra con terminación de sustantivo común («Corporación», «Garantías», «Ponente») o de menos de tres letras
  // (ruido de OCR) sin pista no es un nombre.
    if (!cue && !quoted && named.length === 1 && (COMMON_NOUN_ENDING.test(named[0].f) || named[0].f.length < 3)) return;

    const mid = !(initial && x === a);
    const once = named.length === 1 && (ctx.caps.get(named[0].f) || 0) < 2;
    const strong = cue || quoted || (mid && (named.length >= 2 ? distinctive.length > 0 : !once));
    if (strong) { found.push({ start, end, type: 'NOMBRE', weak: false }); return; }

    // Señales débiles: palabra desconocida al inicio de frase que nunca aparece en minúscula, o que aparece una sola vez.
    if (distinctive.length && distinctive.every((w) => w.w.length >= 3 && !NOT_A_NAME_ENDING.test(w.f))) {
      found.push({ start, end, type: 'NOMBRE', weak: true });
    }
  };

  for (const [a0, b0] of capitalizedRuns(text, words)) {
    let i = a0;
    while (i <= b0) {
      if (!isFree(words[i].s, words[i].e)) { i++; continue; }
      let j = i;
      while (j + 1 <= b0 && isFree(words[j].e, words[j + 1].e)) j++;
      consider(i, j);
      i = j + 1;
    }
  }
  return found;
}

/** Variante sin las palabras que anuncian el nombre: «Proyecto Altamira» → «Altamira», «Conjunto Residencial Los Pinos» → «Los Pinos». */
export function withoutCue(value) {
  const parts = value.trim().split(/\s+/);
  let i = 0;
  while (i < parts.length - 1 && NAME_CUES.has(fold(parts[i]))) i++;
  if (i === 0) return null;
  const rest = parts.slice(i).join(' ');
  return rest.replace(/[^\p{L}]/gu, '').length >= 4 ? rest : null;
}
