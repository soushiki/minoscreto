import JSZip from 'jszip';
import { dictionaryFileName, dictionaryJson, safeName } from '../protectedFiles.js';
import { formatPageRanges } from './document.js';

const LABEL_NOTE = 'Los datos personales se reemplazaron por etiquetas entre corchetes, como [PERSONA_N] o [EMPRESA_N]. '
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

// Las mismas frases de arriba, con cualquier espacio o salto de línea entre palabras: el PDF las parte en renglones.
const loose = (s) => s.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
const UNIT_WORDS = Object.values(UNITS).flatMap((u) => [u.one, u.many]).join('|');
const RANGE = `(?:${UNIT_WORDS})\\s+\\d+(?:\\s*–\\s*\\d+)?`;
const HEAD_LINES = [
  `(?:Expediente\\s+completo|Pasajes\\s+seleccionados\\s+del\\s+expediente)\\s+·\\s+${RANGE}`,
  `\\[Instrucción\\s+para\\s+la\\s+IA\\][\\s\\S]{0,400}?espera\\s+(?:la\\s+siguiente|mi\\s+pregunta)\\.`,
  loose(LABEL_NOTE),
  ...Object.values(UNITS).map((u) => u.note).filter(Boolean).map(loose),
  `(?:El\\s+primer\\s+párrafo\\s+repite|Los\\s+primeros\\s+\\d+\\s+párrafos\\s+repiten)\\s+el\\s+final\\s+de\\s+la\\s+parte\\s+anterior,\\s+solo\\s+como\\s+contexto\\.`
].map((p) => new RegExp(`^\\s*${p}\\s*`));
// El título puede partirse en varios renglones (nombres largos) y llevar corchetes, pero nunca cruza una línea en blanco.
const TITLE = /^\s*(?:#\s+)?((?:[^\n]|\n(?![ \t]*\n)){1,300}?)\s+\(anonimizado\)\s*/;
const PART = new RegExp(`^\\s*Parte\\s+\\d+\\s+de\\s+\\d+\\s+·\\s+${RANGE}\\s*`);

/**
 * Quita del principio de un texto restaurado el encabezado que escribimos solo para la IA (renderWhole, partHeader):
 * título «(anonimizado)», alcance, instrucciones y notas sobre etiquetas. El título queda como el nombre del documento.
 * Solo actúa si el texto empieza con nuestro título o con «Parte n de N»; el resto del documento no se toca.
 */
export function stripAiHeader(text) {
  let rest = text;
  let title = null;
  const t = rest.match(TITLE);
  // Nuestro título siempre va seguido de la línea de alcance: sin ella es el título propio del documento.
  if (t && HEAD_LINES[0].test(rest.slice(t[0].length))) { title = t[1].replace(/\s+/g, ' '); rest = rest.slice(t[0].length); }
  else if (PART.test(rest)) rest = rest.replace(PART, '');
  else return text;
  for (let changed = true; changed;) {
    changed = false;
    for (const re of HEAD_LINES) {
      const m = rest.match(re);
      if (m) { rest = rest.slice(m[0].length); changed = true; }
    }
  }
  return title ? `# ${title}\n\n${rest}` : rest;
}

// Las marcas que pone renderBlocks en su propia línea: [Folio N], [Página N] y «[Folios sin texto legible: …]».
const MARK_TITLES = Object.values(UNITS).filter((u) => u.marker).map((u) => u.title).join('|');
const PAGE_MARK_LINE = new RegExp(`^[ \\t]*\\[(?:${MARK_TITLES})\\s+\\d+\\][ \\t]*(?:\\n|$)`, 'gm');
const EMPTY_MARK_LINE = new RegExp(`^[ \\t]*\\[(?:${MARK_TITLES})s\\s+sin\\s+texto\\s+legible:[^\\]]{0,300}\\][ \\t]*(?:\\n|$)`, 'gm');

/**
 * Quita las marcas de folio o página que escribimos para que la IA cite: el documento restaurado no las tenía.
 * Solo líneas que son únicamente la marca; una cita dentro de una frase («ver [Folio 2]») y el […] de una selección quedan.
 */
export function stripPageMarkers(text) {
  return text.replace(EMPTY_MARK_LINE, '').replace(PAGE_MARK_LINE, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

const pad = (n, total) => String(n).padStart(String(total).length, '0');

export function partFileName(name, number, total, ext = 'md') {
  return `${safeName(name)}_parte-${pad(number, total)}-de-${total}.${ext}`;
}

const README = (name, total, pdf = false) => `${name}: documento protegido en ${total} partes
${'='.repeat(40)}

Este archivo comprimido trae dos carpetas:

1. «para-subir-a-la-IA»: el texto con los nombres y datos personales cambiados por etiquetas
   como [PERSONA_1]. Suba a la IA (ChatGPT, Claude, Gemini u otra) las ${total} partes, en orden,
   una tras otra. Cada parte le pide a la IA que espere hasta tenerlas todas. Cuando la IA
   confirme que recibió las ${total} partes, haga su pregunta.${pdf ? '\n   Cada parte viene en dos formatos, .pdf y .md, con el mismo texto: suba solo uno de los dos.' : ''}

2. «NO-SUBIR»: el diccionario, la llave que dice qué nombre real corresponde a cada etiqueta.
   Guárdelo en un lugar seguro. NUNCA lo suba a la IA ni lo comparta.

Para recuperar los nombres reales en la respuesta de la IA: abra Minoscreto, elija
«Recuperar los nombres reales» y cargue este mismo archivo comprimido (o el diccionario).
Luego pegue la respuesta de la IA.

Todo se hizo en su computador: el documento no se envió a ningún servidor.
`;

/** Expediente en partes: un solo .zip con las partes para la IA, el diccionario aparte y LEAME.txt. */
export async function buildPartsZip({ name, parts, dictionary, type = 'blob', pdf = false, onDropped }) {
  const zip = new JSZip();
  const total = parts.length;
  const folder = zip.folder('para-subir-a-la-IA');
  const dropped = [];
  const writer = pdf ? await import('../pdf/writer.js') : null;
  for (const p of parts) {
    if (writer) {
      const out = await writer.writeTextPdf({ lines: p.text.split('\n') });
      dropped.push(...out.dropped);
      folder.file(partFileName(name, p.number, total, 'pdf'), out.bytes);
    }
    folder.file(partFileName(name, p.number, total), p.text);
  }
  if (dropped.length) onDropped?.(dropped);
  zip.folder('NO-SUBIR').file(dictionaryFileName(name), dictionaryJson(dictionary));
  zip.file('LEAME.txt', README(safeName(name), total, pdf));
  return zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
