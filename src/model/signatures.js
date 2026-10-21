// Bloques de firma: una línea corta con un nombre, después de la raya o de «Firma», o antes de «C.C.» o del cargo.
// Allí el nombre suele ir sin pista ni nombre de pila conocido («____ ¶ YAMILE OSPITIA BORJA ¶ C.C. …»).
import { fold } from './text.js';
import { FIRST_NAMES, SURNAMES, ROLE_WORDS, INSTITUTION_WORDS, COMMON_CAPS, STOP_WORDS, SENTENCE_STARTERS, PLACES } from './lexicon.js';

const LINE_BEFORE = /(?:_{3,}\s*$|^\s*firma(?:s)?\s*[:.]?\s*$|firmado\s+(?:digital|electr[oó]nica)mente\s+por\s*:?\s*$)/iu;
const LINE_AFTER = /^\s*(?:c\.?\s?c\.?(?=[\s\d.:]|$)|cc\s*\d|c[ée]dula|nit\b|(?:firmado\s+(?:digital|electr[oó]nica)mente)|(?:magistrad[oa]|conjuez|contratista|contratante|supervisor[a]?|representante|secretari[oa]|gerente|presidente|presidenta|apoderad[oa]|abogad[oa]|cedente|cesionari[oa]|testigo|arrendador[a]?|arrendatari[oa]|jefe|director[a]?|coordinador[a]?|profesional|asesor[a]?|oficial)\b)/iu;
const WORD = /^[\p{Lu}][\p{L}'’]*$/u;
const LINKS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
const notName = (f) => !FIRST_NAMES.has(f) && !SURNAMES.has(f) && (INSTITUTION_WORDS.has(f) || COMMON_CAPS.has(f) || STOP_WORDS.has(f)
  || SENTENCE_STARTERS.has(f) || PLACES.has(f));

/** El nombre de una línea de firma, sin el cargo que a veces va al final; null si la línea no parece un nombre. */
function nameIn(line) {
  const t = line.trim().replace(/[,.:;]+$/, '');
  if (!t || t.length > 70 || /\d/.test(t)) return null;
  // Usuario de firma digital: «RAMIRO_PEÑA».
  if (/^[\p{Lu}]{2,}(?:_[\p{Lu}]{2,}){1,3}$/u.test(t)) return t;
  const words = t.split(/\s+/);
  let end = words.length;
  while (end > 0 && ROLE_WORDS.has(fold(words[end - 1]))) end--;
  const kept = words.slice(0, end);
  const content = kept.filter((w) => !LINKS.has(fold(w)));
  if (content.length < 2 || content.length > 6) return null;
  if (!content.every((w) => WORD.test(w) && !notName(fold(w)))) return null;
  return kept.join(' ');
}

/** Nombres en bloques de firma: [{ type: 'PERSONA', value }]. */
export function signatureNames(paragraphs) {
  const out = [];
  const texts = paragraphs.map((p) => p.text);
  for (let i = 0; i < texts.length; i++) {
    const before = i > 0 && LINE_BEFORE.test(texts[i - 1]);
    const after = i + 1 < texts.length && LINE_AFTER.test(texts[i + 1]);
    if (!before && !after) continue;
    const value = nameIn(texts[i].replace(/^_{3,}\s*/, ''));
    if (value) out.push({ type: 'PERSONA', value });
  }
  return out;
}
