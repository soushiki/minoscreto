// Nombres de persona que no van con mayúscula inicial: «JUAN CARLOS PÉREZ GÓMEZ», «juan carlos perez gomez», «Juan carlos perez».
// Se apoya en listas de nombres y apellidos frecuentes y en pistas como «señor», «identificado con» o «C.C.».
import { fold } from './text.js';
import {
  FIRST_NAMES, SURNAMES, AMBIGUOUS_FIRST_NAMES, STOP_WORDS, COMMON_CAPS, SENTENCE_STARTERS, INSTITUTION_WORDS, NAME_CUES,
  ORG_PREFIXES, HONORIFICS, PLACES, ROLE_WORDS
} from './lexicon.js';

const WORD_RE = /[\p{L}][\p{L}'’]*/gu;
const LINKS = new Set(['de', 'del', 'la', 'las', 'los']);
const CUE_BEFORE = /(?:se[nñ]or(?:a|es|as)?|sr|sra|srta|don|do[nñ]a|ciudadan[oa]|identificad[oa]\s+con|c\.?\s?c\.?|a\s+favor\s+de|demandante|demandad[oa]|apoderad[oa]|accionante|firma|firmado\s+por|nombre)\s*[:.,]?\s*$/iu;
const CUE_AFTER = /^\s*,?\s*(?:identificad[oa]|c\.?\s?c\.?\s|con\s+c[eé]dula|mayor\s+de\s+edad|quien\s+se\s+identifica)/iu;
const MAX_WORDS = 5;

const styleOf = (w) => (w === w.toUpperCase() ? 'upper' : w === w.toLowerCase() ? 'lower' : 'title');
const isTitleCase = (words) => words.every((w) => styleOf(w.w) === 'title');

/**
 * Busca nombres que el detector principal no ve por no ir en «Tipo Título». Devuelve [{ start, end, weak }]:
 * fuerte con nombre de pila + apellido conocidos (o con una pista de contexto); débil en el resto de casos.
 */
export function detectCaselessNames(text, isFree) {
  const words = [];
  for (const m of text.matchAll(WORD_RE)) words.push({ s: m.index, e: m.index + m[0].length, w: m[0], f: fold(m[0]) });
  const found = [];
  const spaced = (a, b) => /^ {1,2}$/.test(text.slice(words[a].e, words[b].s));

  for (let i = 0; i < words.length; i++) {
    const first = words[i];
    if (!FIRST_NAMES.has(first.f) || !isFree(first.s, first.e)) continue;
    const cue = CUE_BEFORE.test(text.slice(Math.max(0, first.s - 40), first.s));
    const style = styleOf(first.w);
    let j = i;
    let unknown = 0;
    while (j + 1 < words.length && spaced(j, j + 1) && isFree(words[j + 1].s, words[j + 1].e)) {
      const next = words[j + 1];
      const nextStyle = styleOf(next.w);
      // Todo el nombre en el mismo estilo; se admite «Juan carlos perez» (primera con mayúscula y el resto en minúscula).
      const sameCase = nextStyle === style || (style === 'title' && nextStyle === 'lower') || LINKS.has(next.f);
      if (!sameCase) break;
      const known = FIRST_NAMES.has(next.f) || SURNAMES.has(next.f) || LINKS.has(next.f);
      // Con pista de contexto se admite una palabra desconocida en medio («JORGE ELIÉCER GAITÁN»), nunca al final.
      const after = words[j + 2];
      const plausible = cue && unknown < 2 && next.f.length >= 3 && !STOP_WORDS.has(next.f) && !COMMON_CAPS.has(next.f) && !SENTENCE_STARTERS.has(next.f)
        && after && spaced(j + 1, j + 2) && (FIRST_NAMES.has(after.f) || SURNAMES.has(after.f));
      if (!known && !plausible) break;
      if (!known) unknown++;
      j++;
      if (words.slice(i, j + 1).filter((w) => !LINKS.has(w.f)).length >= MAX_WORDS) break;
    }
    while (j > i && LINKS.has(words[j].f)) j--;
    const run = words.slice(i, j + 1);
    const content = run.filter((w) => !LINKS.has(w.f));
    if (content.length < 2 || isTitleCase(content)) { continue; }
    const hasSurname = content.slice(1).some((w) => SURNAMES.has(w.f));
    const after = CUE_AFTER.test(text.slice(run[run.length - 1].e, run[run.length - 1].e + 30));
    const ambiguous = style === 'lower' && AMBIGUOUS_FIRST_NAMES.has(first.f);
    // «fidel castro», todo en minúscula y solo dos palabras, sin pista: se sugiere, no se marca solo.
    const bareLower = style === 'lower' && content.length === 2 && content.every((w) => styleOf(w.w) === 'lower');
    const strong = (hasSurname && !ambiguous && !bareLower) || cue || after;
    found.push({ start: first.s, end: run[run.length - 1].e, weak: !strong });
    i = j;
  }
  return found;
}

const UPPER_WORD = /^[\p{Lu}][\p{Lu}'’]+$/u;
const COMMON_ENDING = /(?:cion|sion|dad|tad|ica|ico|icas|icos|mente|ivo|iva|ento|enta|ancia|encia|ismo|ista|able|ible|ario|aria|oria|orio)$/u;
const UPPER_RE = /[\p{L}][\p{L}'’]*/gu;
const isNameWord = (f) => FIRST_NAMES.has(f) || SURNAMES.has(f);
// Palabras que cortan un nombre en MAYÚSCULAS: títulos, cargos, instituciones, términos del documento.
const breaksName = (f) => !isNameWord(f) && (STOP_WORDS.has(f) || COMMON_CAPS.has(f) || SENTENCE_STARTERS.has(f) || INSTITUTION_WORDS.has(f)
  || NAME_CUES.has(f) || ORG_PREFIXES.has(f) || HONORIFICS.has(f) || PLACES.has(f) || ROLE_WORDS.has(f) || f.length < 3);
const UPPER_CUE_BEFORE = /(?:se[nñ]or(?:a|es|as)?|sr|sra|srta|don|do[nñ]a|dr|dra|doctor|doctora|ciudadan[oa]|identificad[oa]\s+con|a\s+favor\s+de|debe\s+a|por\s+la\s+otra|a\s+saber|suscrit[oa]s?|firmado\s+(?:digitalmente\s+|electr[oó]nicamente\s+)?por|ponencia\s+del?|herederos\s+de|el\s+postulado|los\s+se[nñ]ores|nombres?(?:\s+y\s+apellidos)?(?:\s+completo)?(?:\s+del?\s+(?:contratista|supervisor|cedente|cesionario|afiliado|cotizante|titular|beneficiario)(?:\s+cedente)?)?|(?:contratista|contratante|supervisor[a]?|cedente|cesionario|demandante|demandad[oa]|accionante|apoderad[oa]|representante\s+legal|gerente|elabor[oó]|revis[oó]|aprob[oó]|proyect[oó])(?:\s+del?\s+contrato)?)\s*[:.,]?\s*$/iu;
const UPPER_CUE_AFTER = /^\s*[,;]?\s*(?:identificad[oa]|c\.?\s?c\.?|cc\b|nro\b|n[°º]|con\s+c[eé]dula|mayor\s+de\s+edad|quien\s|en\s+(?:su\s+)?calidad|(?:\(?e\)?\s*)?(?:magistrad[oa]|conjuez|presidente|secretari[oa]|gerente|contratista|cedente|cesionario|supervisor|oficial|representante|profesional|asesor[a]?|jefe|coordinador[a]?|abogad[oa])\b)/iu;

/**
 * Nombres de persona escritos en MAYÚSCULAS («YURANI LORENA PAZ OBANDO», firmas «HORTENSIA ÁVILA CÁRDENAS / Magistrada»).
 * Corta los tramos en títulos, cargos e instituciones; acepta el tramo si tiene dos palabras de nombre conocidas,
 * un nombre de pila conocido en un tramo de 3 a 5 palabras, o una pista antes o después (señor, «Contratista:», C.C.…).
 */
export function detectUpperNames(text, isFree) {
  const words = [];
  for (const m of text.matchAll(UPPER_RE)) words.push({ s: m.index, e: m.index + m[0].length, w: m[0], f: fold(m[0]) });
  const found = [];
  const joined = (a, b) => /^ {1,3}$/.test(text.slice(words[a].e, words[b].s));
  let i = 0;
  while (i < words.length) {
    if (!UPPER_WORD.test(words[i].w) || LINKS.has(words[i].f) || breaksName(words[i].f) || !isFree(words[i].s, words[i].e)) { i++; continue; }
    let j = i;
    while (j + 1 < words.length && joined(j, j + 1) && UPPER_WORD.test(words[j + 1].w) && isFree(words[j + 1].s, words[j + 1].e)
      && (LINKS.has(words[j + 1].f) || !breaksName(words[j + 1].f))) j++;
    while (j > i && LINKS.has(words[j].f)) j--;
    const run = words.slice(i, j + 1);
    const content = run.map((w, k) => ({ ...w, k })).filter((w) => !LINKS.has(w.f));
    const known = content.filter((w) => isNameWord(w.f));
    i = j + 1;
    if (content.length < 2 || content.length > 6 || !known.length) {
      if (!(content.length >= 2 && content.length <= 4 && !known.length)) continue;
    }
    // Con una pista que rodea todo el tramo se toma completo; si no, a lo sumo una palabra desconocida antes del primer
    // nombre conocido y, después del último, hasta completar cuatro.
    const wholeCue = content.length <= 5 && content.every((w) => isNameWord(w.f) || !COMMON_ENDING.test(w.f))
      && (UPPER_CUE_BEFORE.test(text.slice(Math.max(0, content[0].s - 60), content[0].s))
        || UPPER_CUE_AFTER.test(text.slice(content[content.length - 1].e, content[content.length - 1].e + 40)));
    let first = 0;
    let last = content.length - 1;
    if (known.length && !wholeCue) {
      first = Math.max(0, content.indexOf(known[0]) - 1);
      last = Math.max(content.indexOf(known[known.length - 1]), Math.min(content.length - 1, first + 3));
    }
    const kept = content.slice(first, last + 1);
    if (kept.length < 2) continue;
    const start = kept[0].s;
    const end = kept[kept.length - 1].e;
    const before = UPPER_CUE_BEFORE.test(text.slice(Math.max(0, start - 60), start));
    const after = UPPER_CUE_AFTER.test(text.slice(end, end + 40));
    const knownKept = kept.filter((w) => isNameWord(w.f));
    // Un solo nombre conocido basta en un tramo de 3 a 5 palabras si está al principio: «HORTENSIA ÁVILA CÁRDENAS», o apellidos
    // primero como en formularios y planillas, «GALEANO PERDOMO EUDORO».
    const firstName = kept.slice(0, 2).some((w) => isNameWord(w.f));
    // Con solo una pista, ninguna palabra puede tener terminación de sustantivo común («IMPLEMENTACIÓN», «JURÍDICA»).
    const plain = kept.every((w) => isNameWord(w.f) || !COMMON_ENDING.test(w.f));
    const ok = knownKept.length >= 2 || (plain && (before || after || (firstName && kept.length >= 3 && kept.length <= 5)));
    if (ok) found.push({ start, end });
  }
  return found;
}
