// Deja un texto escribible con Helvetica estándar (codificación WinAnsi / CP1252) en pdf-lib.
// Lo que no cabe se aproxima en ASCII o se quita y se informa (S5). Nunca lanza.

// Los 27 caracteres de CP1252 en 0x80–0x9F; el resto de WinAnsi es Latin-1 (0x20–0x7E, 0xA0–0xFF).
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ–—˜™š›œžŸ');

// Aproximaciones fijadas en 02-requirements S5 (comillas curvas y viñeta también, aunque CP1252 las tenga).
const APPROX = new Map([
  ['•', '*'], ['◦', '*'], ['▪', '*'], ['‣', '*'], ['●', '*'], ['○', '*'],
  ['≥', '>='], ['≤', '<='], ['≠', '!='], ['→', '->'], ['←', '<-'], ['⇒', '=>'],
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"], ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
  ['−', '-'], ['‐', '-'], ['‑', '-'], ['\t', ' '],
]);

// Invisibles: se quitan sin aviso (espacios de ancho cero, unión, selectores de variante, BOM).
const INVISIBLE = /^[​-‍⁠﻿︀-️]$/;
const SPACE = /^[ -   　]$/;

const encodable = (ch) => {
  const c = ch.codePointAt(0);
  return ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(ch);
};

export function toWinAnsi(input) {
  const source = typeof input === 'string' ? input.normalize('NFC') : '';
  const replaced = new Set();
  const dropped = new Set();
  let text = '';
  for (const ch of source) {
    if (APPROX.has(ch)) {
      text += APPROX.get(ch);
      replaced.add(ch);
    } else if (SPACE.test(ch)) {
      text += ' ';
      replaced.add(ch);
    } else if (encodable(ch)) {
      text += ch;
    } else if (!INVISIBLE.test(ch) && !/^[\uD800-\uDFFF]$/.test(ch) && ch.codePointAt(0) >= 0x20) {
      dropped.add(ch);
    }
  }
  return { text, replaced: [...replaced], dropped: [...dropped] };
}
