// PDF anonimizado con su diseño original (R1, R2, R4, R5, P1; diseño §4). Corre en la página y maneja el worker:
// abrir → revisar todas las páginas (un escaneo rechaza antes de tocar nada) → cambiar cada página (progreso,
// se puede cancelar entre páginas) → guardar → limpiar → verificar los bytes exactos que se devuelven.
// Cualquier fallo es LayoutRefused y quien llama da el PDF de texto; nada sale sin pasar la verificación (R4).
import { loadEngine as defaultLoadEngine } from '../engine/loader.js';
import { scrubPdf } from '../pdf/scrub.js';
import { classifyPage } from './scan.js';
import { verifyProtected } from './verify.js';
import { LayoutRefused, refusalFrom } from './errors.js';
import { readPdfPages } from '../expediente/pdfjs.js';
import { buildDocument } from '../expediente/document.js';
import { crossPagePieces } from './crossPage.js';

/** Tope del archivo de entrada (diseño §Interfaces): más grande es 'too-large' sin cargar el motor. */
export const MAX_LAYOUT_BYTES = 80 * 1024 * 1024;

const abortError = (signal) => signal.reason ?? new DOMException('Cancelado', 'AbortError');
function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal);
}

// Una aguja por valor activo y por cada alias, con su etiqueta. Los datos desactivados no se tocan.
function needlesFor(entities) {
  return entities
    .filter((e) => e.enabled)
    .flatMap((e) => [e.value, ...(e.aliases || [])].filter((v) => typeof v === 'string' && v.trim()).map((value) => ({ value, put: `[${e.label}]` })));
}

/**
 * @param {{ bytes: Uint8Array, password?: string, entities: object[],
 *           onProgress?: (p: { phase: 'engine' | 'scan' | 'edit' | 'save' | 'verify', done: number, total: number }) => void,
 *           signal?: AbortSignal, loadEngine?: () => Promise<object> }} options
 * @returns {Promise<{ bytes: Uint8Array, imagePages: number[] }>} imagePages: páginas (desde 1) con imágenes,
 *   que pueden llevar datos que no se cambiaron (R2).
 * @throws {LayoutRefused} o el motivo de `signal` si se cancela (eso no cae al PDF de texto).
 */
export function protectLayout(options) {
  // El worker es uno y guarda un solo documento abierto: dos llamadas a la vez (doble clic) se turnan.
  const run = queue.then(() => protectOnce(options));
  queue = run.catch(() => {});
  const signal = options?.signal;
  if (!signal) return run;
  // Cancelar mientras espera turno responde ya; el turno, cuando llegue, sale en su primer checkAbort.
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {});
  // Una señal que dura mucho (reusada en varias descargas) no acumula oyentes.
  return Promise.race([run, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}

let queue = Promise.resolve();

// Trozos de valores partidos por un salto de folio, por página (T12c). Cualquier fallo da un mapa vacío: la
// verificación final sigue protegiendo (un valor que no se cambió se rechaza).
async function crossPageOf(bytes, password, needles) {
  try {
    let asked = false;
    const askPassword = async () => (asked ? null : ((asked = true), password));
    const pages = await readPdfPages(bytes.slice(), { askPassword });
    // La compuerta lee el texto con y sin la corrección de 0/1 del OCR: se unen los trozos de las dos lecturas.
    const merged = new Map();
    const seen = new Set();
    for (const options of [{ fixOcr: false }, {}]) {
      for (const [page, list] of crossPagePieces(buildDocument(pages, options).paragraphs, needles)) {
        for (const piece of list) {
          const key = `${page}|${piece.edge}|${piece.put}|${piece.context}|${piece.value}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!merged.has(page)) merged.set(page, []);
          merged.get(page).push(piece);
        }
      }
    }
    return merged;
  } catch {
    return new Map();
  }
}

async function protectOnce({ bytes, password = '', entities, onProgress = () => {}, signal, loadEngine = defaultLoadEngine }) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new TypeError('protectLayout: bytes must be a non-empty Uint8Array');
  if (!Array.isArray(entities)) throw new TypeError('protectLayout: entities must be an array');
  if (typeof password !== 'string') throw new TypeError('protectLayout: password must be a string');
  checkAbort(signal);
  if (bytes.length > MAX_LAYOUT_BYTES) throw new LayoutRefused('too-large', { where: 'input' });

  const needles = needlesFor(entities);
  onProgress({ phase: 'engine', done: 0, total: 1 });
  let engine;
  try {
    engine = await loadEngine();
  } catch (error) {
    throw refusalFrom(error);
  }
  checkAbort(signal);

  let saved;
  let imagePages;
  let opened = false;
  try {
    const { pageCount } = await engine.open(bytes, password);
    opened = true;

    const scans = [];
    imagePages = [];
    for (let p = 0; p < pageCount; p++) {
      checkAbort(signal);
      const stats = await engine.pageStats(p);
      if (classifyPage(stats) === 'scan') scans.push(p + 1);
      else if (stats.hasImages) imagePages.push(p + 1);
      onProgress({ phase: 'scan', done: p + 1, total: pageCount });
    }
    if (scans.length) throw new LayoutRefused('scan', { pages: scans });

    const pieces = await crossPageOf(bytes, password, needles);
    checkAbort(signal);
    for (let p = 0; p < pageCount; p++) {
      checkAbort(signal);
      await engine.editPage(p, { mode: 'protect', needles: [...needles, ...(pieces.get(p) ?? [])] });
      onProgress({ phase: 'edit', done: p + 1, total: pageCount });
    }
    checkAbort(signal);
    onProgress({ phase: 'save', done: 0, total: 1 });
    saved = await engine.save();
    if (!(saved instanceof Uint8Array) || saved.length === 0) throw new LayoutRefused('engine', { where: 'save' });
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    throw refusalFrom(error);
  } finally {
    // Libera el documento en el worker; si el motor murió, no hay nada que cerrar.
    if (opened && engine.alive !== false) await engine.close().catch(() => {});
  }

  let clean;
  try {
    clean = await scrubPdf(saved);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    throw new LayoutRefused('error', { cause: error, where: 'scrub' });
  }
  checkAbort(signal);
  onProgress({ phase: 'verify', done: 0, total: 1 });
  // Se verifica el mismo arreglo que se devuelve; nadie más tiene referencia a él.
  let verdict;
  try {
    if (!(clean instanceof Uint8Array)) throw new TypeError('scrub no devolvió bytes');
    verdict = await verifyProtected(clean, entities);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    throw new LayoutRefused('error', { cause: error, where: 'verify' }); // sin prueba de limpieza no sale nada (R4)
  }
  checkAbort(signal);
  if (verdict?.ok !== true) throw new LayoutRefused(verdict?.reason === 'missed-value' ? 'missed-value' : 'error', { where: verdict?.where ?? 'verify' });
  onProgress({ phase: 'verify', done: 1, total: 1 });
  return { bytes: clean, imagePages };
}
