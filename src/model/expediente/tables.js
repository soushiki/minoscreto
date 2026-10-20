// Tablas en la capa de texto de un PDF (idea de Docling, con la geometría de pdf.js): si el encabezado de una columna
// dice «Cédula», «Identificación», «NIT», «Teléfono»…, los números de esa columna son de ese tipo aunque no lleven pista.
const HEADERS = [
  { type: 'CEDULA', re: /^(?:c[ée]dula|c\.?\s?c\.?|identificaci[oó]n|n[°º.]?\s*(?:de\s+)?identificaci[oó]n|documento(?:\s+de\s+identidad)?|no\.?\s+documento|tipo\s+y\s+n[uú]mero)\b/iu },
  { type: 'NIT', re: /^nit\b/iu },
  { type: 'TELEFONO', re: /^(?:tel[ée]fono|tel\.?|celular|cel\.?|m[oó]vil)\b/iu },
  { type: 'CUENTA', re: /^(?:n[°º.]?\s*(?:de\s+)?cuenta|cuenta(?:\s+bancaria)?)\b/iu }
];
import { nitCheckDigitOk } from '../scores.js';

const VALUE = {
  CEDULA: /(?<![\d.,])(\d{1,3}(?:\.\d{3}){1,3}|\d{6,10})(?![\d.,]?\d)/gu,
  NIT: /(?<![\d.])(\d{1,3}(?:\.\d{3}){2}-\d|\d{9}-\d|[89]\d{8})(?![\d-])/gu,
  TELEFONO: /(?<!\d)((?:\+?57\s?)?(?:3\d{2}|60\d)?[\s.-]?\d{3}[\s.-]?\d{4}|\d{7})(?!\d)/gu,
  CUENTA: /(?<!\d)(\d[\d-]{6,20}\d)(?!\d)/gu
};
// Una columna dura mientras sus filas estén cerca (menos de cuatro renglones de distancia entre filas).
const MAX_ROW_GAP = 4;

const overlaps = (a, b) => a.x < b.right && b.x < a.right;

/** Datos tipados por el encabezado de su columna, en todas las páginas: [{ type, value, page }]. */
export function findTableHints(pages) {
  const hints = [];
  for (const page of pages) {
    const lines = page.lines.filter((l) => l.cells && Number.isFinite(l.y));
    for (let i = 0; i < lines.length; i++) {
      for (const cell of lines[i].cells) {
        const header = !/\d/.test(cell.text) && cell.text.length <= 40 && HEADERS.find((h) => h.re.test(cell.text));
        if (!header) continue;
        // La columna: el ancho del encabezado, un poco más amplio porque los valores no se alinean exacto.
        const col = { x: cell.x - lines[i].h, right: cell.right + lines[i].h * 2 };
        let lastY = lines[i].y;
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j];
          if (lastY - line.y > line.h * MAX_ROW_GAP || line.y > lastY) break;
          const below = line.cells.filter((c) => overlaps(c, col));
          if (!below.length) continue;
          if (below.some((c) => HEADERS.some((h) => h.re.test(c.text)))) break;
          lastY = line.y;
          for (const c of below) {
            for (const m of c.text.matchAll(VALUE[header.type])) {
              // En una columna «NIT» de un OCR ruidoso caen códigos contables: el dígito de verificación los descarta.
              if (header.type === 'NIT' && nitCheckDigitOk(m[1]) === false) continue;
              if (/\$\s*$/.test(c.text.slice(0, m.index))) continue;
              hints.push({ type: header.type, value: m[1].trim(), page: page.number });
            }
          }
        }
      }
    }
  }
  return hints;
}
