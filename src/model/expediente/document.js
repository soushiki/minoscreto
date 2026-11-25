import { linesToParagraphs, isHeading, joinText, continuesOnNextPage, joinFormPairs } from './layout.js';
import { reducePages } from './reduce.js';
import { fixDigitConfusions } from './ocr.js';
import { findTableHints } from './tables.js';

const MIN_TEXT = 20;

export const estimateTokens = (chars) => Math.ceil(chars / 4);

/** Folios sin capa de texto (o casi): probablemente escaneos a los que les falta el OCR. */
export function findEmptyPages(pages) {
  return pages
    .filter((p) => p.lines.reduce((n, l) => n + (l.text.match(/[\p{L}\p{N}]/gu) || []).length, 0) < MIN_TEXT)
    .map((p) => p.number);
}

/**
 * Convierte las páginas leídas del PDF en párrafos con su folio ({ text, page, endPage, heading }).
 * Un párrafo cortado por el salto de folio se une (para no partir un nombre en dos); su folio es donde empieza.
 * Con `reduce` quita encabezados, pies, números de página y basura del OCR. Sin `reduce` los conserva
 * como párrafos propios, después del párrafo que cruza el folio. Con `fixOcr` corrige 0/1 dentro de palabras.
 */
export function buildDocument(pages, { reduce = false, fixOcr = true } = {}) {
  const empty = new Set(findEmptyPages(pages));
  // Etiqueta y valor de un formulario se unen antes de reducir, para que top/bottom/lines salgan coherentes; las pistas de tablas usan `pages` tal cual.
  const source = reducePages(pages.map((p) => ({ ...p, lines: joinFormPairs(p.lines) })), { junk: reduce });
  const paragraphs = [];
  let ocrFixes = 0;
  let pageJoins = 0;
  let lastBody = null;
  let deferred = [];

  const clean = (raw) => {
    if (!fixOcr) return raw;
    const fixed = fixDigitConfusions(raw);
    ocrFixes += fixed.fixes;
    return fixed.text;
  };
  const make = (text, page, pair) => ({ text, page, endPage: page, heading: isHeading(text), ...(pair ? { pair } : {}) });
  const furniture = (lines, page) => (reduce ? [] : lines.map((l) => make(l.text, page)));

  for (const page of source.pages) {
    if (empty.has(page.number)) { paragraphs.push(...deferred); deferred = []; lastBody = null; continue; }
    const found = linesToParagraphs(page.lines, { flags: true });
    const body = found.map((p) => clean(p.text));
    const top = furniture(page.top, page.number);
    let start = 0;
    if (body.length && !found[0].pair && !lastBody?.pair && lastBody && lastBody.endPage === page.number - 1 && continuesOnNextPage(lastBody.text, body[0])) {
      lastBody.text = joinText(lastBody.text, body[0]);
      // `at`: dónde empieza en el texto unido lo que venía en este folio (joinText deja `b` entero al final).
      (lastBody.joins ??= []).push({ at: lastBody.text.length - body[0].length, page: page.number });
      lastBody.endPage = page.number;
      pageJoins++;
      start = 1;
    }
    paragraphs.push(...deferred, ...top);
    for (let i = start; i < body.length; i++) {
      lastBody = make(body[i], page.number, found[i].pair);
      paragraphs.push(lastBody);
    }
    deferred = furniture(page.bottom, page.number);
  }
  paragraphs.push(...deferred);

  const chars = paragraphs.reduce((n, p) => n + p.text.length + 2, 0);
  return {
    paragraphs, hints: findTableHints(pages), emptyPages: [...empty], removed: reduce ? source.removed : null, ocrFixes, pageJoins, chars,
    tokens: estimateTokens(chars),
    unit: 'folio', pageCount: pages.length
  };
}

/** Agrupa números de folio en rangos legibles: [3, 4, 5, 9] → «3–5, 9». */
export function formatPageRanges(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return out.join(', ');
}
