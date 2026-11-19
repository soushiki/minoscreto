// Núcleo del conector de Minoscreto para Claude Desktop: lee un archivo del disco, lo anonimiza con el mismo
// modelo que la página y escribe el texto protegido y su diccionario junto al original. Restaura textos y
// archivos de la IA al disco. Nada de esto devuelve un valor real: solo etiquetas, conteos y rutas.
import './dom.mjs';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  addValue, buildDictionary, buildDocx, buildEntities, dictionaryFileName, dictionaryJson, exportCode, nameFromDictionary,
  protectedFileName, readDictionaryFrom, restoreDocx, restoreText, setEnabled
} from '../src/model/index.js';
import {
  anonymizeTexts, buildDocument, buildDocxDocument, itemsToLines, renderWhole, tidyEntities
} from '../src/model/expediente/index.js';
import { stripAiHeader, stripPageMarkers } from '../src/model/expediente/render.js';
import { readDocxParagraphs } from '../src/model/expediente/docxSource.js';
import { rejoinTags } from '../src/model/pdf/rejoin.js';
import { writeTextPdf } from '../src/model/pdf/writer.js';

export const MAX_BYTES = 200 * 1024 * 1024;
/** Lo que vuelve a Claude en una sola respuesta; el resto se pide con leerProtegido. */
export const CHUNK_CHARS = 100_000;
const INPUTS = new Set(['.pdf', '.docx', '.txt', '.md']);
const OUTPUTS = new Set(['.docx', '.pdf', '.md', '.txt']);
const PROTECTED = /_protegido\.md$/i;
const OUR_FOOTER = /^\s*Página \d+ de \d+\s*$/;

export class ToolError extends Error {}

function checkPath(path, what) {
  if (typeof path !== 'string' || !path.trim()) throw new ToolError(`Falta la ruta ${what}.`);
  if (!isAbsolute(path)) throw new ToolError(`La ruta ${what} debe ser completa (por ejemplo C:\\Users\\...\\archivo.pdf).`);
  return path.trim();
}

async function readInput(path, what) {
  let info;
  try { info = await stat(path); } catch { throw new ToolError(`No existe el archivo ${what}: ${path}`); }
  if (!info.isFile()) throw new ToolError(`La ruta ${what} no es un archivo: ${path}`);
  if (info.size > MAX_BYTES) throw new ToolError(`El archivo ${what} pesa más de 200 MB.`);
  return new Uint8Array(await readFile(path));
}

const exists = (path) => access(path).then(() => true, () => false);

/** Nunca sobrescribe: «x.md» ocupado → «x (2).md». */
async function freePath(path) {
  if (!(await exists(path))) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new ToolError('No se encontró un nombre libre para el archivo de salida.');
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer()); // Blob
}

async function readPdfPages(bytes) {
  const task = getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    if (error?.name === 'PasswordException') {
      throw new ToolError('El PDF tiene contraseña. Quítasela (o ábrelo en minoscreto.netlify.app) y vuelve a intentarlo.');
    }
    throw new ToolError('No se pudo leer el PDF.');
  }
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push({ number: n, lines: itemsToLines((await page.getTextContent()).items) });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

// Texto plano: «\f» separa páginas; cada línea no vacía es un párrafo.
const textParagraphs = (text) => text.replace(/^\uFEFF/, '').split('\n')
  .map((line) => ({ text: line.replace(/\s+$/, ''), kind: 'main', label: '', breaks: [] }));

async function readDocument(path, bytes, reduce) {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') {
    const pages = await readPdfPages(bytes);
    return { kind: 'pdf', build: (opts) => buildDocument(pages, opts), reduce };
  }
  let paragraphs;
  if (ext === '.docx') {
    try { ({ paragraphs } = await readDocxParagraphs(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))); }
    catch { throw new ToolError('Este archivo no parece un Word válido. ¿Está protegido con contraseña?'); }
  } else {
    paragraphs = textParagraphs(new TextDecoder('utf-8').decode(bytes));
  }
  return { kind: ext.slice(1), build: (opts) => buildDocxDocument(paragraphs, opts), reduce };
}

/** Las etiquetas que el usuario pidió no ocultar ([PERSONA_3] o PERSONA_3) y los textos extra que sí. */
function adjustEntities(entities, { mantener = [], agregar = [] }) {
  let list = entities;
  const unknownKeep = [];
  for (const raw of mantener) {
    const label = String(raw).trim().replace(/^\[|\]$/g, '').toUpperCase();
    const entity = list.find((e) => e.label === label);
    if (entity) list = setEnabled(list, entity.id, false);
    else unknownKeep.push(label);
  }
  for (const raw of agregar) {
    const text = String(raw).trim();
    if (text.length >= 2) list = addValue(list, { text, type: 'OTRO' });
  }
  return { entities: list, unknownKeep };
}

/**
 * Anonimiza un archivo. Escribe «documento-CODE_protegido.md» y «Nombre_diccionario-CODE.json» en `carpetaSalida`
 * (o junto al original) y devuelve el texto protegido (primer trozo si es largo), conteos por tipo y las rutas.
 */
export async function anonymizeFile({ ruta, reducir = false, mantener = [], agregar = [], carpetaSalida } = {}) {
  const path = checkPath(ruta, 'del documento');
  if (!INPUTS.has(extname(path).toLowerCase())) throw new ToolError('Recibo PDF, Word (.docx), .txt o .md. Si es .doc, guárdalo como .docx en Word.');
  const outDir = carpetaSalida ? checkPath(carpetaSalida, 'de la carpeta de salida') : dirname(path);
  const bytes = await readInput(path, 'del documento');
  const source = await readDocument(path, bytes, reducir);

  const full = source.build();
  if (!full.paragraphs.length) {
    throw new ToolError(source.kind === 'pdf' ? 'Este PDF no tiene texto: hazle OCR y vuelve a intentarlo.' : 'Este archivo no tiene texto.');
  }
  const doc = reducir ? source.build({ reduce: true }) : full;
  // Como la página: se detecta sobre la versión completa, que ve todos los datos.
  const detected = tidyEntities(buildEntities(full.paragraphs, { hints: full.hints || [] })).map((e, i) => ({ ...e, id: `x${i + 1}` }));
  const { entities, unknownKeep } = adjustEntities(detected, { mantener, agregar });

  const texts = doc.paragraphs.map((p) => p.text);
  const applied = anonymizeTexts(texts, entities);
  const blocks = doc.paragraphs.map((p, index) => ({ index, page: p.page, heading: p.heading, text: applied.texts[index] }));
  const text = renderWhole({ blocks, emptyPages: full.emptyPages, unit: doc.unit });
  const dictionary = buildDictionary(entities, new Set(applied.usedIds), applied.sources);

  const code = exportCode();
  const name = basename(path, extname(path));
  const protectedPath = await freePath(join(outDir, protectedFileName(code, 'md')));
  const dictionaryPath = await freePath(join(outDir, dictionaryFileName(name, code)));
  try {
    await writeFile(dictionaryPath, dictionaryJson(dictionary), { flag: 'wx' });
    await writeFile(protectedPath, text, { flag: 'wx' });
  } catch (error) {
    throw new ToolError(`No se pudo escribir en ${outDir}: ${error.code || error.message}`);
  }

  const byType = {};
  for (const e of entities) {
    if (e.enabled && applied.usedIds.includes(e.id)) byType[e.type] = (byType[e.type] || 0) + 1;
  }
  return {
    protectedPath, dictionaryPath, code,
    pages: full.pageCount, unit: doc.unit, emptyPages: full.emptyPages,
    replacements: applied.replacements, byType, unknownKeep,
    totalChars: text.length, text: text.slice(0, CHUNK_CHARS), more: text.length > CHUNK_CHARS
  };
}

/** Un trozo de un archivo protegido ya escrito. Solo abre archivos «…_protegido.md»: nunca un original. */
export async function readProtected({ ruta, desde = 0 } = {}) {
  const path = checkPath(ruta, 'del texto protegido');
  if (!PROTECTED.test(basename(path))) throw new ToolError('Solo leo archivos «…_protegido.md» que escribió esta herramienta.');
  const text = new TextDecoder('utf-8').decode(await readInput(path, 'del texto protegido'));
  const start = Math.max(0, Math.floor(Number(desde) || 0));
  const end = Math.min(text.length, start + CHUNK_CHARS);
  return { text: text.slice(start, end), from: start, to: end, totalChars: text.length, more: end < text.length };
}

async function readDictionaryFile(path) {
  const bytes = await readInput(path, 'del diccionario');
  try { return await readDictionaryFrom(bytes); }
  catch (error) { throw new ToolError(`Diccionario no válido: ${error.message}`); }
}

function defaultOutput(dictionaryPath, ext) {
  const stem = nameFromDictionary(basename(dictionaryPath)) ?? 'texto';
  return join(dirname(dictionaryPath), `${stem}-restaurado${ext}`);
}

async function writeRestored(text, outPath) {
  const ext = extname(outPath).toLowerCase();
  let bytes;
  let dropped = [];
  if (ext === '.docx') bytes = await toBytes(await buildDocx(text.split('\n')));
  else if (ext === '.pdf') ({ bytes, dropped } = await writeTextPdf({ lines: text.split('\n') }));
  else bytes = new TextEncoder().encode(text);
  await writeFile(outPath, bytes, { flag: 'wx' });
  return dropped.length > 0;
}

const total = (counts) => Object.values(counts || {}).reduce((n, c) => n + c, 0);

/**
 * Pone los valores reales en un texto de la IA (`texto`) o en un archivo suyo (`ruta`: .docx, .pdf, .md, .txt)
 * y lo escribe en disco. Devuelve la ruta, cuántas etiquetas se cambiaron y las que el diccionario no tiene.
 */
export async function restore({ texto, ruta, diccionario, rutaSalida, formato } = {}) {
  if ((texto == null) === (ruta == null)) throw new ToolError('Pasa el texto de la IA o la ruta de su archivo (uno de los dos).');
  const dictionaryPath = checkPath(diccionario, 'del diccionario');
  const dictionary = await readDictionaryFile(dictionaryPath);

  let inExt = null;
  let restored;
  if (ruta != null) {
    const path = checkPath(ruta, 'del archivo de la IA');
    inExt = extname(path).toLowerCase();
    if (!OUTPUTS.has(inExt)) throw new ToolError('Restauro .docx, .pdf, .md o .txt.');
    const bytes = await readInput(path, 'del archivo de la IA');
    if (inExt === '.docx') {
      let result;
      try { result = await restoreDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), dictionary); }
      catch { throw new ToolError('No se pudo procesar el Word.'); }
      const outPath = await freePath(rutaSalida ? checkPath(rutaSalida, 'de salida') : defaultOutput(dictionaryPath, '.docx'));
      if (extname(outPath).toLowerCase() !== '.docx') throw new ToolError('Un Word restaurado se guarda como .docx.');
      await writeFile(outPath, await toBytes(result.blob), { flag: 'wx' });
      return { outPath, replaced: total(result.counts), unknown: result.unknown, omittedChars: false };
    }
    let raw;
    if (inExt === '.pdf') {
      const pages = await readPdfPages(bytes);
      raw = pages.map((p) => {
        const lines = p.lines.map((l) => (typeof l === 'string' ? l : l.text));
        return (lines.length && OUR_FOOTER.test(lines[lines.length - 1]) ? lines.slice(0, -1) : lines).join('\n');
      }).join('\n');
    } else {
      raw = new TextDecoder('utf-8').decode(bytes);
    }
    // Como la página: etiquetas partidas al extraer se unen; el encabezado para la IA y las marcas [Folio N] se quitan.
    const joined = rejoinTags(raw, dictionary);
    const result = restoreText(stripPageMarkers(stripAiHeader(joined.text)), dictionary);
    restored = { text: result.text, counts: result.counts, unknown: [...new Set([...result.unknown, ...joined.broken])] };
  } else {
    if (typeof texto !== 'string' || !texto.trim()) throw new ToolError('El texto está vacío.');
    const result = restoreText(texto, dictionary);
    restored = { text: result.text, counts: result.counts, unknown: result.unknown };
  }

  const ext = rutaSalida ? extname(rutaSalida).toLowerCase() : `.${formato || (inExt ? inExt.slice(1) : 'docx')}`;
  if (!OUTPUTS.has(ext)) throw new ToolError('El resultado se guarda como .docx, .pdf, .md o .txt.');
  const outPath = await freePath(rutaSalida ? checkPath(rutaSalida, 'de salida') : defaultOutput(dictionaryPath, ext));
  let omittedChars;
  try { omittedChars = await writeRestored(restored.text, outPath); }
  catch (error) { throw new ToolError(`No se pudo escribir ${outPath}: ${error.code || error.message}`); }
  return { outPath, replaced: total(restored.counts), unknown: restored.unknown, omittedChars };
}
