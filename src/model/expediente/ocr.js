// Corrige la confusión más común del OCR: ceros y unos dentro de palabras («J0rge», «Mora1es», «0scar»).
// Sin esto el detector corta los nombres en el dígito y deja pedazos sin anonimizar.

// Palabras con letras y dígitos, que no sean parte de un correo, ruta, código o número con puntos.
const MIXED = /(?<![\p{L}\p{N}@._/\\#-])[\p{L}\p{N}]*\p{L}[\p{L}\p{N}]*(?![\p{L}\p{N}@_/\\#-]|\.[\p{L}\p{N}])/gu;

function fixWord(word) {
  const digits = word.match(/\p{N}/gu);
  if (!digits || digits.length > 2 || /[2-9]/.test(word)) return word;
  if (word.length - digits.length < 3 || !/\p{Ll}/u.test(word)) return word;
  if (/^\p{N}/u.test(word) && !/^[01]\p{Ll}/u.test(word)) return word;
  return word
    .replace(/^0/, 'O').replace(/^1/, 'I')
    .replace(/0/g, 'o').replace(/1/g, 'l');
}

export function fixDigitConfusions(text) {
  let fixes = 0;
  const out = text.replace(MIXED, (w) => {
    const fixed = fixWord(w);
    if (fixed !== w) fixes++;
    return fixed;
  });
  return { text: out, fixes };
}
