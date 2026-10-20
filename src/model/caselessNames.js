// Nombres de persona que no van con mayúscula inicial: «JUAN CARLOS PÉREZ GÓMEZ», «juan carlos perez gomez», «Juan carlos perez».
// Se apoya en listas de nombres y apellidos frecuentes y en pistas como «señor», «identificado con» o «C.C.».
import { fold } from './text.js';
import { FIRST_NAMES, SURNAMES, AMBIGUOUS_FIRST_NAMES, STOP_WORDS, COMMON_CAPS, SENTENCE_STARTERS } from './lexicon.js';

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
    const strong = (hasSurname && !ambiguous) || cue || after;
    found.push({ start: first.s, end: run[run.length - 1].e, weak: !strong });
    i = j;
  }
  return found;
}
