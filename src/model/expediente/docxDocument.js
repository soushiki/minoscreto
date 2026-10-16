import { isHeading } from './layout.js';
import { isJunk, isPageNumber } from './reduce.js';
import { fixDigitConfusions } from './ocr.js';
import { estimateTokens } from './document.js';

/**
 * Convierte los párrafos de un Word ({ text, kind: 'main'|'furniture'|'note', label, breaks }) en el mismo
 * documento que produce un PDF. Las páginas salen de los saltos que Word guardó al paginar
 * (lastRenderedPageBreak) o, si no hay, de los saltos manuales; sin ninguno, la unidad es el párrafo.
 * Con `reduce` quita encabezados y pies, números de página y basura del OCR; las notas y comentarios
 * van al final, con su etiqueta.
 */
export function buildDocxDocument(input, { reduce = false, fixOcr = true } = {}) {
  const main = input.filter((p) => p.kind === 'main');
  const rendered = main.some((p) => p.breaks.some((b) => b.rendered));
  const counted = (p) => p.breaks.filter((b) => b.rendered === rendered);
  const hasPages = main.some((p) => counted(p).length > 0);
  const unit = hasPages ? 'pagina' : 'parrafo';
  const removed = { repeated: 0, pageNumbers: 0, junk: 0, chars: 0 };
  const paragraphs = [];
  const tail = [];
  let ocrFixes = 0;
  let page = 1;
  let ordinal = 0;

  const clean = (raw) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!fixOcr) return text;
    const fixed = fixDigitConfusions(text);
    ocrFixes += fixed.fixes;
    return fixed.text;
  };
  const drop = (reason, text) => { removed[reason]++; removed.chars += text.length; };

  for (const p of input) {
    const text = clean(p.text);
    if (p.kind !== 'main') {
      if (!text) continue;
      if (reduce && p.kind === 'furniture') { drop('repeated', text); continue; }
      tail.push(`${p.label || 'Nota'}: ${text}`);
      continue;
    }
    let start = page;
    let end = page;
    if (hasPages) {
      for (const b of counted(p)) {
        if (!p.text.slice(0, b.at).trim()) start++;
        end++;
      }
      page = end;
    }
    if (!text) continue;
    ordinal++;
    if (reduce && isPageNumber(text)) { drop('pageNumbers', text); continue; }
    if (reduce && isJunk(text)) { drop('junk', text); continue; }
    const where = hasPages ? { page: start, endPage: end } : { page: ordinal, endPage: ordinal };
    paragraphs.push({ text, ...where, heading: isHeading(text) });
  }
  const last = paragraphs.length ? paragraphs[paragraphs.length - 1].endPage : 1;
  for (const text of tail) {
    const at = hasPages ? last : ++ordinal;
    paragraphs.push({ text, page: at, endPage: at, heading: false });
  }

  const chars = paragraphs.reduce((n, p) => n + p.text.length + 2, 0);
  return {
    paragraphs, emptyPages: [], removed: reduce ? removed : null, ocrFixes, pageJoins: 0, chars, tokens: estimateTokens(chars),
    unit, pageCount: hasPages ? page : ordinal
  };
}
