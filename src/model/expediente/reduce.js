import { fold } from '../text.js';

// Zona de encabezado y pie: hasta 3 líneas arriba y abajo, menos en folios cortos para no tocar el cuerpo.
const edgeSize = (count) => Math.min(3, Math.max(1, Math.floor(count / 4)));
const PAGE_NUMBER = /^(?:[-–]\s*)?(?:p[áa]g(?:ina)?\.?|folio|fl\.?|fls\.?|hoja)?\s*(?:no\.?\s*)?\d{1,4}\s*(?:(?:de|\/)\s*\d{1,4})?(?:\s*[-–])?$/iu;

const signature = (text) => fold(text).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

export const isPageNumber = (text) => PAGE_NUMBER.test(text.trim());

/** Líneas que el OCR deja como ruido: solo símbolos, casi sin letras, o letras sueltas separadas. */
export function isJunk(text) {
  const t = text.trim();
  if (!t) return false;
  const alnum = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  if (alnum === 0) return true;
  const visible = t.replace(/\s/g, '').length;
  if (visible >= 4 && alnum / visible < 0.5) return true;
  const tokens = t.split(/\s+/);
  return tokens.length >= 3 && tokens.every((tok) => tok.replace(/[^\p{L}\p{N}]/gu, '').length <= 1) && !/\d/.test(t);
}

const edgeIndexes = (count) => {
  const set = new Set();
  for (let i = 0; i < edgeSize(count); i++) { set.add(i); set.add(count - 1 - i); }
  return set;
};

/**
 * Reduce el tamaño sin perder contenido: quita encabezados y pies repetidos en muchas páginas,
 * números de página y (con `junk`) líneas basura del OCR. Recibe [{ number, lines: [{ text, ... }] }].
 * Cada página devuelta trae aparte lo quitado arriba (`top`) y abajo (`bottom`).
 */
export function reducePages(pages, { junk = true } = {}) {
  const withText = pages.filter((p) => p.lines.length);
  const threshold = Math.max(3, Math.ceil(withText.length * 0.3));
  const seen = new Map();
  for (const page of withText) {
    const sigs = new Set();
    for (const i of edgeIndexes(page.lines.length)) sigs.add(signature(page.lines[i].text));
    for (const s of sigs) seen.set(s, (seen.get(s) || 0) + 1);
  }
  const repeated = new Set([...seen].filter(([s, n]) => s && n >= threshold && withText.length >= 3).map(([s]) => s));
  const removed = { repeated: 0, pageNumbers: 0, junk: 0, chars: 0 };

  const out = pages.map((page) => {
    const edges = edgeIndexes(page.lines.length);
    const top = [];
    const bottom = [];
    const lines = page.lines.filter((line, i) => {
      let reason = null;
      if (edges.has(i) && repeated.has(signature(line.text))) reason = 'repeated';
      else if (edges.has(i) && isPageNumber(line.text)) reason = 'pageNumbers';
      else if (junk && isJunk(line.text)) reason = 'junk';
      if (!reason) return true;
      removed[reason]++;
      removed.chars += line.text.length;
      if (reason !== 'junk') (i < page.lines.length / 2 ? top : bottom).push(line);
      return false;
    });
    return { ...page, lines, top, bottom };
  });
  return { pages: out, removed, repeatedLines: repeated.size };
}
