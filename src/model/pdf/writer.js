// Escribe líneas de texto en un PDF Carta con Helvetica estándar. pdf-lib se carga solo aquí y solo con
// import() dinámico (ADR-001). Las etiquetas [TIPO_n] son una sola pieza al partir líneas. Nunca lanza por glifos.
import { toWinAnsi } from './winAnsi.js';

const PAGE = { width: 612, height: 792 };
const MARGIN = 54;
const BODY = { size: 11, lead: 15 };
const HEADING = { size: 15, lead: 22 };
const FOOTER_SIZE = 9;
const FOOTER_Y = 28;
const TEXT_WIDTH = PAGE.width - 2 * MARGIN;
const BOTTOM = MARGIN + 6;
const YIELD_EVERY = 10;

// Misma forma de etiqueta que usa la restauración (docx/restore.js).
const TAG = '\\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9_ ]{1,40}\\]';
const WORD = new RegExp(`(?:${TAG}|\\S)+`, 'g');
const UNIT = new RegExp(`${TAG}|[^]`, 'g');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Parte una palabra más ancha que la línea por ancho, sin cortar nunca una etiqueta.
function breakWord(word, width, measure) {
  const pieces = [];
  let current = '';
  for (const unit of word.match(UNIT)) {
    if (current && measure(current + unit) > width) {
      pieces.push(current);
      current = unit;
    } else {
      current += unit;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function wrap(text, width, measure) {
  const rows = [];
  let row = '';
  for (const [word] of text.matchAll(WORD)) {
    const candidate = row ? `${row} ${word}` : word;
    if (measure(candidate) <= width) {
      row = candidate;
      continue;
    }
    if (row) rows.push(row);
    if (measure(word) <= width) {
      row = word;
    } else {
      const pieces = breakWord(word, width, measure);
      row = pieces.pop();
      rows.push(...pieces);
    }
  }
  rows.push(row);
  return rows;
}

function layout(lines, fonts) {
  const pages = [[]];
  let y = PAGE.height - MARGIN;
  const place = (item, lead) => {
    if (y - lead < BOTTOM && pages.at(-1).length) {
      pages.push([]);
      y = PAGE.height - MARGIN;
    }
    y -= lead;
    if (item) pages.at(-1).push({ ...item, y });
  };
  for (const line of lines) {
    const heading = line.startsWith('# ');
    const style = heading ? HEADING : BODY;
    const font = heading ? fonts.bold : fonts.regular;
    const measure = (s) => font.widthOfTextAtSize(s, style.size);
    const body = heading ? line.slice(2) : line;
    if (!body.trim()) {
      place(null, BODY.lead);
      continue;
    }
    for (const row of wrap(body, TEXT_WIDTH, measure)) place({ text: row, font, size: style.size }, style.lead);
  }
  return pages;
}

/** lines: texto ya renderizado, una línea por elemento. Devuelve { bytes, replaced, dropped } (S5). */
export async function writeTextPdf({ lines, onProgress } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const clean = toWinAnsi((Array.isArray(lines) ? lines : []).join('\n'));
  const doc = await PDFDocument.create();
  doc.setProducer('Minoscreto');
  doc.setCreator('Minoscreto');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  const pages = layout(clean.text.split('\n'), fonts);
  const total = pages.length;
  for (let n = 0; n < total; n++) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    for (const { text, font, size, y } of pages[n]) page.drawText(text, { x: MARGIN, y, size, font, color: rgb(0, 0, 0) });
    const footer = `Página ${n + 1} de ${total}`;
    page.drawText(footer, {
      x: PAGE.width - MARGIN - fonts.regular.widthOfTextAtSize(footer, FOOTER_SIZE),
      y: FOOTER_Y, size: FOOTER_SIZE, font: fonts.regular, color: rgb(0.3, 0.3, 0.3)
    });
    onProgress?.(n + 1, total);
    if ((n + 1) % YIELD_EVERY === 0) await tick();
  }
  return { bytes: await doc.save(), replaced: clean.replaced, dropped: clean.dropped };
}
