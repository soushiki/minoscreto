// Control final del PDF con formato (R2, R4, S7, ADR-006). Corre sobre los bytes exactos que se descargan:
// - verifyProtected: ningún dato activo queda en el texto de las páginas (pdf.js) ni en ninguna cadena o flujo
//   decodificado del archivo, y no quedan claves prohibidas (metadatos, anotaciones, formularios…).
// - verifyRestored: ninguna etiqueta conocida queda en el texto, ni siquiera cortada (rejoinTags).
// Usa el mismo buscador del anonimizador (anonymizeTexts / fold): mismas reglas de mayúsculas y tildes, sin
// una segunda regla más laxa. Falla cerrado: un archivo que no se puede leer entero no pasa.
// El resultado nunca lleva el dato encontrado, solo dónde.
import { anonymizeTexts } from '../expediente/anonymize.js';
import { buildDocument } from '../expediente/document.js';
import { readPdfPages } from '../expediente/pdfjs.js';
import { rejoinTags } from '../pdf/rejoin.js';
import { listTextualObjects } from '../pdf/scrub.js';
import { fold } from '../text.js';

// Filtros de imagen: lo que hay dentro de una imagen queda fuera del control (R1 avisa de las imágenes).
const IMAGE_FILTERS = new Set(['/DCTDecode', '/JPXDecode', '/JBIG2Decode', '/CCITTFaxDecode']);
const DECODED_FILTERS = new Set(['/FlateDecode', '/LZWDecode', '/ASCII85Decode', '/ASCIIHexDecode', '/RunLengthDecode']);

const DECODERS = ['windows-1252', 'utf-8', 'utf-16be'].map((label) => new TextDecoder(label, { fatal: false }));
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
const HAS_HEX_STRING = /<[0-9A-Fa-f\s]{2,}>/;
// Trozos de un flujo grande: se revisan de a CHUNK bytes con un solapamiento que cubre el dato más largo
// escrito en hexadecimal UTF-16, y se cede el hilo entre trozos (P1: sin bloqueos de más de 1 s).
const CHUNK = 256 * 1024;
const PAGE_TEXT_BATCH = 400;

const pass = () => ({ ok: true });
const fail = (reason, where) => ({ ok: false, reason, where });

function checkBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new TypeError('verify: bytes must be a non-empty Uint8Array');
}

// pdf.js puede quedarse con el búfer que recibe: se le da una copia para que los bytes que se descargan no cambien.
async function pageTexts(bytes) {
  const pages = await readPdfPages(bytes.slice());
  const lines = pages.flatMap((p) => p.lines.map((l) => l.text));
  return { pages, lines };
}

const hexToBytes = (digits) => {
  const clean = digits.replace(/\s+/g, '');
  const even = clean.length % 2 ? `${clean}0` : clean;
  const out = new Uint8Array(even.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(even.slice(2 * i, 2 * i + 2), 16);
  return out;
};

// Lee la cadena literal «( … )» que abre en `i` (paréntesis anidados, escapes «\351», «\(», fin de línea).
function literalAt(src, i) {
  let depth = 1;
  let out = '';
  let k = i + 1;
  while (k < src.length && depth > 0) {
    const c = src[k];
    if (c === '\\') {
      const oct = /^[0-7]{1,3}/.exec(src.slice(k + 1, k + 4));
      if (oct) { out += String.fromCharCode(parseInt(oct[0], 8) & 0xff); k += 1 + oct[0].length; continue; }
      const e = src[k + 1];
      if (e === '\r' || e === '\n') { k += e === '\r' && src[k + 2] === '\n' ? 3 : 2; continue; }
      out += ESCAPES[e] ?? e ?? '';
      k += 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) break;
    out += c;
    k++;
  }
  return { text: out, end: k + 1 };
}

// Texto que muestran los operadores de un flujo de contenido, aunque nadie lo dibuje: las piezas de un arreglo
// TJ «[(Lau)-10(ra)]» van pegadas, los Tj sucesivos con un espacio y, aparte, todo pegado.
function shownStrings(src) {
  const shows = [];
  let arr = null;
  const push = (s) => (arr ? arr.push(s) : shows.push(s));
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '(') { const lit = literalAt(src, i); push(lit.text); i = lit.end; } else if (c === '<' && src[i + 1] !== '<') {
      const close = src.indexOf('>', i);
      if (close === -1) break;
      if (/^[0-9A-Fa-f\s]*$/.test(src.slice(i + 1, close))) push(String.fromCharCode(...hexToBytes(src.slice(i + 1, close))));
      i = close + 1;
    } else if (c === '[') { arr = []; i++; } else if (c === ']') { if (arr) shows.push(arr.join('')); arr = null; i++; } else i++;
  }
  if (arr) shows.push(arr.join(''));
  return shows.length ? [shows.join(' '), shows.join('')] : [];
}

const latin1Bytes = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
// Un carácter por byte (TextDecoder 'latin1' es en realidad windows-1252 y cambia 0x80–0x9F).
function bytesToLatin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

// Lecturas posibles de unos bytes: WinAnsi, UTF-8, UTF-16BE (en las dos alineaciones) y el texto de sus
// cadenas (escapes resueltos, hexadecimales decodificadas, piezas de TJ unidas) en WinAnsi y UTF-16BE.
function readings(bytes) {
  const out = [];
  for (const decoder of DECODERS) out.push(decoder.decode(bytes));
  if (bytes.length > 2) out.push(DECODERS[2].decode(bytes.subarray(1)));
  const ansi = out[0];
  if (ansi.includes('(') || HAS_HEX_STRING.test(ansi)) {
    const src = bytesToLatin1(bytes);
    // Además cada bloque BT…ET por separado: un «(» suelto en datos binarios no se traga las cadenas de después.
    const blocks = src.split(/(?<![^\s\]>)])BT(?=[\s[(<])/);
    for (const shown of [...shownStrings(src), ...(blocks.length > 1 ? blocks.flatMap(shownStrings) : [])]) {
      const raw = latin1Bytes(shown);
      out.push(DECODERS[0].decode(raw), DECODERS[2].decode(raw));
    }
  }
  return out;
}

// fold trabaja carácter por carácter y conserva el largo, así que plegar cada carácter da fold(texto) sin
// llenar su caché con textos enormes. Cada coincidencia cruda se confirma con anonymizeTexts sobre una ventana
// con sus vecinos: el buscador decide (bordes de palabra, datos desactivados), no esta búsqueda previa.
const foldedUnits = new Array(65536);
function foldLong(text) {
  const parts = new Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    parts[i] = foldedUnits[unit] ??= fold(text[i]);
  }
  return parts.join('');
}

function leaksIn(text, targets, entities) {
  if (!text) return false;
  const folded = foldLong(text);
  for (const target of targets) {
    let at = folded.indexOf(target);
    while (at !== -1) {
      const window = text.slice(Math.max(0, at - 1), at + target.length + 1);
      if (anonymizeTexts([window], entities).replacements > 0) return true;
      at = folded.indexOf(target, at + 1);
    }
  }
  return false;
}

const activeTargets = (entities) => [...new Set(entities.filter((e) => e.enabled)
  .flatMap((e) => [e.value, ...(e.aliases || [])]).map((v) => fold(v)).filter(Boolean))];

const imageOnly = (filter) => {
  const names = String(filter).split(/\s+/).filter(Boolean);
  return names.some((n) => IMAGE_FILTERS.has(n)) && names.every((n) => IMAGE_FILTERS.has(n) || DECODED_FILTERS.has(n));
};

const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * ¿Quedó algún dato activo en el PDF anonimizado? → { ok: true } o { ok: false, reason, where }.
 * reason 'missed-value' (where 'page-text' | 'object') o 'error' (where 'unreadable' | 'revisions' | 'undecoded' |
 * 'forbidden-key' | 'check-failed').
 */
async function blobLeaks(blob, targets, entities, overlap) {
  for (let start = 0; start < blob.length; start += CHUNK) {
    const slice = blob.subarray(start, Math.min(blob.length, start + CHUNK + overlap));
    if (readings(slice).some((text) => leaksIn(text, targets, entities))) return true;
    if (blob.length > CHUNK) await yieldToPage();
  }
  return false;
}

// Revisiones = tablas «startxref N %%EOF» (no cualquier «%%EOF» dentro de un flujo), buscadas en los bytes.
const STARTXREF = [...'startxref'].map((c) => c.charCodeAt(0));
function revisions(bytes) {
  let count = 0;
  for (let i = bytes.indexOf(STARTXREF[0]); i !== -1; i = bytes.indexOf(STARTXREF[0], i + 1)) {
    if (!STARTXREF.every((b, j) => bytes[i + j] === b)) continue;
    if (/^startxref\s+\d+\s+%%EOF/.test(bytesToLatin1(bytes.subarray(i, i + 40)))) count++;
  }
  return count;
}

// Copia de `bytes` con los cuerpos codificados ya leídos decodificados cambiados por espacios (0x20), solo donde
// empiezan como datos de un flujo (tras «stream» + salto de línea). Una sola pasada; nunca toca `bytes`.
const KEYWORD = [...'stream'].map((c) => c.charCodeAt(0));
function rawMinusBodies(bytes, bodies) {
  const copy = new Uint8Array(bytes);
  const byPrefix = new Map();
  for (const body of bodies) {
    if (!body.length) continue;
    const key = body.subarray(0, 8).join(',');
    byPrefix.set(key, [...(byPrefix.get(key) ?? []), body]);
  }
  const equalAt = (p, body) => body.every((b, j) => copy[p + j] === b);
  for (let i = copy.indexOf(KEYWORD[0]); i !== -1; i = copy.indexOf(KEYWORD[0], i + 1)) {
    if (!KEYWORD.every((b, j) => copy[i + j] === b) || copy[i - 1] === 0x64) continue;
    let p = i + 6;
    if (copy[p] === 13) p++;
    if (copy[p++] !== 10) continue;
    const hit = byPrefix.get(copy.subarray(p, p + 8).join(','))?.find((body) => equalAt(p, body));
    if (hit) copy.fill(0x20, p, p + hit.length);
  }
  return copy;
}

async function checkProtected(bytes, entities) {
  let pages;
  let lines;
  let objects;
  try {
    ({ pages, lines } = await pageTexts(bytes));
    objects = await listTextualObjects(bytes);
  } catch {
    return fail('error', 'unreadable');
  }

  // El mismo texto que vio la detección (párrafos unidos entre líneas y folios, con y sin la corrección del
  // OCR) y además cada línea sola.
  const texts = [
    ...lines,
    ...buildDocument(pages).paragraphs.map((p) => p.text),
    ...buildDocument(pages, { fixOcr: false }).paragraphs.map((p) => p.text),
  ];
  for (let i = 0; i < texts.length; i += PAGE_TEXT_BATCH) {
    if (anonymizeTexts(texts.slice(i, i + PAGE_TEXT_BATCH), entities).replacements > 0) return fail('missed-value', 'page-text');
    if (texts.length > PAGE_TEXT_BATCH) await yieldToPage();
  }

  const targets = activeTargets(entities);
  if (targets.length) {
    const overlap = 4 * Math.max(...targets.map((t) => t.length)) + 64;
    // Cada cadena y flujo alcanzable, decodificado, y además el archivo entero tal cual: un objeto suelto o
    // una revisión vieja sin comprimir también cuentan, aunque la limpieza ya los haya quitado. El paso crudo
    // se salta los cuerpos codificados que ya se leyeron decodificados (ADR-011).
    for (const blob of [...objects.strings, ...objects.streams, rawMinusBodies(bytes, objects.encodedBodies)]) {
      if (await blobLeaks(blob, targets, entities, overlap)) return fail('missed-value', 'object');
    }
  }
  if (revisions(bytes) > 1) return fail('error', 'revisions');
  if (objects.undecoded.some((u) => !imageOnly(u.filter))) return fail('error', 'undecoded');
  if (objects.forbidden.length) return fail('error', 'forbidden-key');
  return pass();
}

export async function verifyProtected(bytes, entities) {
  checkBytes(bytes);
  if (!Array.isArray(entities)) throw new TypeError('verify: entities must be an array');
  // Falla cerrado: cualquier error al revisar (memoria, un flujo raro) es «no se pudo probar limpio».
  try {
    return await checkProtected(bytes, entities);
  } catch {
    return fail('error', 'check-failed');
  }
}

/**
 * ¿Quedó alguna etiqueta conocida sin su valor en el PDF restaurado? → { ok: true } o { ok: false, reason, where }.
 * Las etiquetas cortadas por saltos de línea o guiones cuentan (rejoinTags).
 */
export async function verifyRestored(bytes, dict) {
  checkBytes(bytes);
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) throw new TypeError('verify: dict must be an object');
  let pages;
  try {
    ({ pages } = await pageTexts(bytes));
  } catch {
    return fail('error', 'unreadable');
  }
  try {
    const keys = Object.keys(dict).filter((k) => k.trim());
    const perPage = pages.map((p) => p.lines.map((l) => l.text).join('\n'));
    const texts = [...perPage, perPage.join('\n')].map((t) => rejoinTags(t, dict).text);
    if (texts.some((t) => keys.some((k) => t.includes(k)))) return fail('missed-value', 'page-text');
    return pass();
  } catch {
    return fail('error', 'check-failed');
  }
}
