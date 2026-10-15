import JSZip from 'jszip';
import { dictionaryToText } from '../dictionary.js';
import { formatPageRanges } from './document.js';

const LABEL_NOTE = 'Los datos personales se reemplazaron por etiquetas entre corchetes, como [PERSONA_1] o [EMPRESA_2]. '
  + 'Son las mismas en todas las partes: úsalas tal cual en tus respuestas, sin intentar adivinar los datos reales.';

/**
 * Unidad con la que se ubica el texto: folios del PDF, páginas del Word (según su última paginación)
 * o, en un Word sin saltos de página, el número de párrafo (sin marcas dentro del texto).
 */
export const UNITS = {
  folio: {
    one: 'folio', many: 'folios', title: 'Folio', marker: (n) => `[Folio ${n}]`,
    note: '[Folio N] marca dónde empieza cada folio; cítalos así. Un párrafo que cruza de un folio al siguiente queda entero donde empieza.'
  },
  pagina: {
    one: 'página', many: 'páginas', title: 'Página', marker: (n) => `[Página ${n}]`,
    note: '[Página N] marca dónde empezaba cada página del documento original (aproximado); cítalas así.'
  },
  parrafo: { one: 'párrafo', many: 'párrafos', title: 'Párrafo', marker: null, note: '' }
};
export const unitOf = (unit) => UNITS[unit] || UNITS.folio;

const range = (u, a, b) => (a === b ? `${u.one} ${a}` : `${u.many} ${a}–${b}`);
const notes = (u) => [LABEL_NOTE, u.note].filter(Boolean).join(' ');

/**
 * Escribe los bloques como texto con marcas [Folio N] (o [Página N]). Señala con […] los saltos de una
 * selección y con «sin texto» los folios que no tenían OCR.
 */
export function renderBlocks(blocks, emptyPages = [], unit = 'folio') {
  const u = unitOf(unit);
  const empty = [...emptyPages].sort((a, b) => a - b);
  const out = [];
  let page = null;
  let index = null;
  for (const b of blocks) {
    if (index !== null && b.index !== index + 1) out.push('[…]');
    if (b.page !== page && u.marker) {
      const between = page === null ? [] : empty.filter((n) => n > page && n < b.page);
      if (between.length) out.push(`[${u.title}s sin texto legible: ${formatPageRanges(between)}]`);
      out.push(u.marker(b.page));
    }
    out.push(b.text);
    page = b.page;
    index = b.index;
  }
  return out.join('\n\n') + '\n';
}

export function renderWhole({ name, blocks, emptyPages, selection = false, unit = 'folio' }) {
  const u = unitOf(unit);
  const first = blocks[0]?.page ?? 0;
  const last = blocks[blocks.length - 1]?.page ?? 0;
  const head = [
    `# ${name} (anonimizado)`,
    `${selection ? 'Pasajes seleccionados del expediente' : 'Expediente completo'} · ${range(u, first, last)}`,
    notes(u)
  ];
  return head.join('\n\n') + '\n\n' + renderBlocks(blocks, selection ? [] : emptyPages, unit);
}

export function partHeader({ number, total, first, last, overlapCount, unit = 'folio' }) {
  const u = unitOf(unit);
  const lines = [`Parte ${number} de ${total} · ${range(u, first, last)}`];
  if (number < total) {
    lines.push(`[Instrucción para la IA] Este expediente llega dividido en ${total} partes y esta es la parte ${number}. `
      + `No lo analices todavía: responde solo «Recibida la parte ${number} de ${total}» y espera la siguiente.`);
  } else {
    lines.push(`[Instrucción para la IA] Esta es la última parte (${number} de ${total}). Ya tienes el expediente completo: `
      + `responde «Recibidas las ${total} partes» y espera mi pregunta.`);
  }
  lines.push(notes(u));
  if (overlapCount > 0) lines.push(`${overlapCount === 1 ? 'El primer párrafo repite' : `Los primeros ${overlapCount} párrafos repiten`} el final de la parte anterior, solo como contexto.`);
  return lines.join('\n\n');
}

/** Texto de cada parte: encabezado con folios e instrucción, y luego sus párrafos (con el solapamiento al inicio). */
export function renderParts({ blocks, parts, emptyPages, selection = false, unit = 'folio' }) {
  return parts.map((p, k) => {
    const own = blocks.slice(p.from, p.to);
    const first = own[0].page;
    const last = own[own.length - 1].page;
    const header = partHeader({ number: k + 1, total: parts.length, first, last, overlapCount: p.from - p.overlapFrom, unit });
    const pagesHere = emptyPages.filter((n) => n >= first && n <= last);
    return { number: k + 1, first, last, text: header + '\n\n' + renderBlocks(blocks.slice(p.overlapFrom, p.to), selection ? [] : pagesHere, unit) };
  });
}

const pad = (n, total) => String(n).padStart(String(total).length, '0');
const safeName = (name) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'expediente';

export function partFileName(name, number, total) {
  return `${safeName(name)}-parte-${pad(number, total)}-de-${total}.md`;
}

const README = (total) => `Cómo usar estos archivos
========================

1. Sube a la IA, en orden, los ${total} archivos de la carpeta «para-subir-a-la-IA». Cada uno empieza con «Parte X de ${total}» y le pide a la IA que espere hasta tener todas.
2. Cuando la IA confirme que recibió las ${total} partes, haz tu pregunta.
3. Para volver a ver los nombres reales en la respuesta, abre Minoscreto › Restaurar nombres y carga el diccionario de la carpeta «NO-SUBIR».

NUNCA subas la carpeta «NO-SUBIR»: el diccionario contiene los datos reales.
`;

/** ZIP con las partes para la IA y, aparte, el diccionario para restaurar. */
export async function buildPartsZip({ name, parts, dictionary, type = 'blob' }) {
  const zip = new JSZip();
  const total = parts.length;
  const folder = zip.folder('para-subir-a-la-IA');
  for (const p of parts) folder.file(partFileName(name, p.number, total), p.text);
  const secret = zip.folder('NO-SUBIR');
  secret.file('diccionario.json', JSON.stringify(dictionary, null, 2));
  secret.file('diccionario.txt', dictionaryToText(dictionary));
  zip.file('LEEME.txt', README(total));
  return zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
