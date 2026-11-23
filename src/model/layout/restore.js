// PDF con etiquetas devuelto con los datos reales y su diseño (R7, R8; T13). Espejo de protect.js: el motor
// dibuja el valor del diccionario donde estaba cada etiqueta conocida; la verificación exige que no quede ninguna.
// Cualquier fallo es LayoutRefused y quien llama (T14) cae al texto restaurado; nada sale sin verificar.
import { loadEngine as defaultLoadEngine } from '../engine/loader.js';
import { scrubPdf } from '../pdf/scrub.js';
import { classifyPage } from './scan.js';
import { verifyRestored } from './verify.js';
import { LayoutRefused, refusalFrom } from './errors.js';
import { MAX_LAYOUT_BYTES } from './protect.js';
import { inTurn } from './turns.js';
import { toWinAnsi } from '../pdf/winAnsi.js';
import { VARIANTS_KEY } from '../dictionary.js';

const TAG = /^\[[\x21-\x5c\x5e-\x7e]{1,60}\]$/; // como en el motor (pdfium.js): ASCII visible, sin «]» dentro
const MAX_PUT = 500;

const abortError = (signal) => signal.reason ?? new DOMException('Cancelado', 'AbortError');
function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal);
}

// Una aguja por etiqueta del diccionario. Un valor vacío o muy largo no se pone: la etiqueta queda y la verificación rechaza.
function needlesFor(dict) {
  const needles = [];
  for (const [key, value] of Object.entries(dict)) {
    if (key === VARIANTS_KEY || !TAG.test(key) || typeof value !== 'string') continue;
    const put = toWinAnsi(value).text.replace(/\s+/g, ' ').trim();
    if (!put || put.length > MAX_PUT) continue;
    needles.push({ value: key, put });
  }
  return needles;
}

/**
 * @param {{ bytes: Uint8Array, password?: string, dict: Record<string, string>,
 *           onProgress?: (p: { phase: 'engine' | 'scan' | 'edit' | 'save' | 'verify', done: number, total: number }) => void,
 *           signal?: AbortSignal, loadEngine?: () => Promise<object> }} options
 * @returns {Promise<{ bytes: Uint8Array, imagePages: number[] }>}
 * @throws {LayoutRefused} o el motivo de `signal` si se cancela.
 */
export function restoreLayout(options) {
  return inTurn(() => restoreOnce(options), options?.signal);
}

async function restoreOnce({ bytes, password = '', dict, onProgress = () => {}, signal, loadEngine = defaultLoadEngine }) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new TypeError('restoreLayout: bytes must be a non-empty Uint8Array');
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) throw new TypeError('restoreLayout: dict must be an object');
  if (typeof password !== 'string') throw new TypeError('restoreLayout: password must be a string');
  checkAbort(signal);
  if (bytes.length > MAX_LAYOUT_BYTES) throw new LayoutRefused('too-large', { where: 'input' });

  const needles = needlesFor(dict);
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

    for (let p = 0; p < pageCount; p++) {
      checkAbort(signal);
      await engine.editPage(p, { mode: 'restore', needles });
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
  let verdict;
  try {
    if (!(clean instanceof Uint8Array)) throw new TypeError('scrub no devolvió bytes');
    verdict = await verifyRestored(clean, dict);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    throw new LayoutRefused('error', { cause: error, where: 'verify' });
  }
  checkAbort(signal);
  if (verdict?.ok !== true) throw new LayoutRefused(verdict?.reason === 'missed-value' ? 'missed-value' : 'error', { where: verdict?.where ?? 'verify' });
  onProgress({ phase: 'verify', done: 1, total: 1 });
  return { bytes: clean, imagePages };
}
