// @vitest-environment node
// Motor PDFium (T4): worker (open / pageStats / close con PDFium real), cargador (hash, fetch, wasm bloqueado),
// y el fitness de ADR-004 sobre src/.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode } from 'pdf-lib';
import { createPdfium } from '../src/engine-worker/pdfium.js';
import { createWorkerHandler } from '../src/engine-worker/index.js';
import { createEngineLoader, EngineError } from '../src/model/engine/loader.js';

const root = resolve(__dirname, '..');
const fixture = (name) => new Uint8Array(readFileSync(join(root, 'tests/fixtures', name)));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Cuenta reservas y páginas abiertas para comprobar que todo se libera, también en los errores.
function countingRuntime(runtime) {
  const live = new Set();
  const opened = { page: 0, text: 0 };
  const mem = new Proxy(runtime.mem, {
    get(target, key) {
      if (key === 'alloc') return (size) => { const ptr = target.alloc(size); live.add(ptr); return ptr; };
      if (key === 'free') return (ptr) => { live.delete(ptr); target.free(ptr); };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const delta = { FPDF_LoadPage: ['page', 1], FPDF_ClosePage: ['page', -1], FPDFText_LoadPage: ['text', 1], FPDFText_ClosePage: ['text', -1] };
  const fn = new Proxy(runtime.fn, {
    get(target, key) {
      const value = target[key];
      if (!delta[key]) return value;
      return (...args) => { const out = value(...args); opened[delta[key][0]] += delta[key][1]; return out; };
    }
  });
  return { runtime: { fn, mem }, live, opened };
}

// Escaneo sintético: una imagen a página completa y la capa OCR invisible (modo 3), como OCRmyPDF.
async function scanLikePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const png = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText('Juzgado Primero Civil del Circuito de Cartagena', { x: 50, y: 700, size: 12, font, color: rgb(0, 0, 0) });
  page.pushOperators(popGraphicsState());
  return pdf.save({ useObjectStreams: false });
}

let runtime;
beforeAll(async () => {
  runtime = await createPdfRuntime({ prefer: 'wasm' });
}, 60_000);

describe('engine worker: PDFium wrapper', () => {
  it('opens a text PDF, reports page stats and frees every pointer on close', () => {
    const counted = countingRuntime(runtime);
    const pdfium = createPdfium(counted.runtime);
    expect(pdfium.open(fixture('tabla_sintetico.pdf'))).toEqual({ pageCount: 2 });
    const stats = pdfium.pageStats(0);
    expect(stats.visibleChars).toBeGreaterThanOrEqual(30);
    expect(stats.invisibleChars).toBe(0);
    expect(stats.hasImages).toBe(false);
    expect(stats.imageCoverage).toBe(0);
    expect(counted.opened).toEqual({ page: 0, text: 0 });
    pdfium.close();
    expect(counted.live.size).toBe(0);
  });

  it('a scan-like page: full-page image, only invisible text', async () => {
    const pdfium = createPdfium(runtime);
    pdfium.open(await scanLikePdf());
    const stats = pdfium.pageStats(0);
    expect(stats).toMatchObject({ visibleChars: 0, hasImages: true });
    expect(stats.invisibleChars).toBeGreaterThanOrEqual(30);
    expect(stats.imageCoverage).toBeGreaterThan(0.99);
    pdfium.close();
  });

  it('an image inside a form XObject is measured in page space, not by the form\'s box', async () => {
    // Página interior con un logo de 100×100; la exterior la dibuja como un solo formulario a página completa
    // y otra la dibuja a escala 0,5 en (100, 100), como hacen algunos generadores.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
    const inner = await PDFDocument.create();
    const innerPage = inner.addPage([595, 842]);
    innerPage.drawImage(await inner.embedPng(png), { x: 0, y: 0, width: 100, height: 100 });
    const innerFull = await PDFDocument.create();
    innerFull.addPage([595, 842]).drawImage(await innerFull.embedPng(png), { x: 0, y: 0, width: 595, height: 842 });
    const outer = await PDFDocument.create();
    const [logoForm] = await outer.embedPdf(await inner.save());
    const [fullForm] = await outer.embedPdf(await innerFull.save());
    outer.addPage([595, 842]).drawPage(logoForm, { x: 0, y: 0 });
    outer.addPage([595, 842]).drawPage(logoForm, { x: 100, y: 100, xScale: 0.5, yScale: 0.5 });
    outer.addPage([595, 842]).drawPage(fullForm, { x: 0, y: 0 });
    const pdfium = createPdfium(runtime);
    pdfium.open(await outer.save({ useObjectStreams: false }));
    const area = 595 * 842;
    const [logo, scaled, full] = [0, 1, 2].map((p) => pdfium.pageStats(p));
    expect(logo.hasImages).toBe(true);
    expect(logo.imageCoverage).toBeCloseTo((100 * 100) / area, 3);
    expect(scaled.imageCoverage).toBeCloseTo((50 * 50) / area, 3);
    expect(full.imageCoverage).toBeGreaterThan(0.99);
    pdfium.close();
  });

  it('opens a locked PDF only with its password; a wrong one leaks nothing', () => {
    const counted = countingRuntime(runtime);
    const pdfium = createPdfium(counted.runtime);
    const locked = fixture('contrasena_usuario_sintetico.pdf');
    expect(() => pdfium.open(locked, 'otra-cosa')).toThrow(expect.objectContaining({ code: 'password' }));
    expect(counted.live.size).toBe(0);
    expect(pdfium.open(locked, 'minoscreto-prueba').pageCount).toBeGreaterThan(0);
    pdfium.close();
    expect(counted.live.size).toBe(0);
  });

  it('rejects bad input and bad page numbers without leaking', () => {
    const counted = countingRuntime(runtime);
    const pdfium = createPdfium(counted.runtime);
    expect(() => pdfium.pageStats(0)).toThrow(expect.objectContaining({ code: 'no-document' }));
    expect(() => pdfium.open(new Uint8Array(0))).toThrow(expect.objectContaining({ code: 'bad-input' }));
    expect(() => pdfium.open(new TextEncoder().encode('no es un PDF'))).toThrow(expect.objectContaining({ code: 'open' }));
    pdfium.open(fixture('prosa_sintetico.pdf'));
    for (const bad of [-1, 99, 0.5, '0']) expect(() => pdfium.pageStats(bad)).toThrow(expect.objectContaining({ code: 'bad-page' }));
    pdfium.close();
    pdfium.close(); // cerrar dos veces no falla
    expect(counted.live.size).toBe(0);
    expect(counted.opened).toEqual({ page: 0, text: 0 });
  });
});

describe('engine worker: message protocol', () => {
  it('init → ready, then calls answer by id; errors carry the PDFium code', async () => {
    const replies = [];
    const handle = createWorkerHandler((message) => replies.push(message), () => runtime);
    await handle({ data: { type: 'call', id: 1, method: 'open', args: [] } });
    expect(replies.pop()).toEqual({ type: 'result', id: 1, ok: false, error: { code: 'not-ready' } });
    await handle({ data: { type: 'init', wasmBinary: new Uint8Array(0) } });
    expect(replies.pop()).toEqual({ type: 'ready' });
    await handle({ data: { type: 'call', id: 2, method: 'open', args: [fixture('tabla_sintetico.pdf'), ''] } });
    expect(replies.pop()).toEqual({ type: 'result', id: 2, ok: true, result: { pageCount: 2 } });
    await handle({ data: { type: 'call', id: 3, method: 'pageStats', args: [5] } });
    expect(replies.pop()).toMatchObject({ type: 'result', id: 3, ok: false, error: { code: 'bad-page' } });
    await handle({ data: { type: 'call', id: 4, method: 'constructor', args: [] } });
    expect(replies.pop()).toEqual({ type: 'result', id: 4, ok: false, error: { code: 'bad-method' } });
    await handle({ data: { type: 'call', id: 5, method: 'close' } });
    expect(replies.pop()).toMatchObject({ id: 5, ok: true });
  });

  it('a runtime that fails to start (wasm blocked) answers error, not ready', async () => {
    const replies = [];
    const handle = createWorkerHandler((message) => replies.push(message), async () => { throw new Error('CompileError: WebAssembly.instantiate(): Refused to compile'); });
    await handle({ data: { type: 'init', wasmBinary: new Uint8Array(0) } });
    expect(replies).toEqual([{ type: 'error', message: expect.stringContaining('Refused to compile') }]);
  });
});

// Worker falso: responde como el real, o como se le pida en `behaviour`.
function installFakes({ files, behaviour = 'ready' } = {}) {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.terminated = false;
      this.posted = [];
      workers.push(this);
    }
    postMessage(message, transfer = []) {
      this.posted.push({ message, transfer });
      const reply = (data) => queueMicrotask(() => !this.terminated && this.onmessage?.({ data }));
      if (message.type === 'init') {
        if (behaviour === 'ready') reply({ type: 'ready' });
        else if (behaviour === 'wasm-blocked') reply({ type: 'error', message: 'CompileError: Refused to compile' });
        else if (behaviour === 'crash') queueMicrotask(() => this.onerror?.({ message: 'boom', preventDefault() {} }));
        else if (behaviour === 'clone-error') throw new DOMException('could not be cloned', 'DataCloneError');
      } else if (message.type === 'call') {
        if (message.method === 'pageStats') reply({ type: 'result', id: message.id, ok: true, result: { visibleChars: 40, invisibleChars: 0, imageCoverage: 0, hasImages: false } });
        if (message.method === 'open') reply({ type: 'result', id: message.id, ok: false, error: { code: 'password' } });
        // 'close' no responde: sirve para probar terminate() con llamadas pendientes
      }
    }
    terminate() {
      this.terminated = true;
    }
  }
  const fetchMock = vi.fn(async (url, init) => {
    const body = files[url];
    if (body === undefined) return new Response('no', { status: 404 });
    if (body instanceof Error) throw body;
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', fetchMock);
  return { workers, fetchMock };
}

const workerCode = new TextEncoder().encode('self.onmessage = () => {};');
const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const ENGINE = {
  worker: { url: '/engine/worker.aaaaaaaa.js', sha256: sha256(workerCode) },
  wasm: { url: '/engine/embedpdf.bbbbbbbb.wasm', sha256: sha256(wasmBytes) }
};
const goodFiles = { [ENGINE.worker.url]: workerCode, [ENGINE.wasm.url]: wasmBytes };

describe('engine loader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GETs both files, checks them, starts one worker with the wasm transferred, and is memoized', async () => {
    const { workers, fetchMock } = installFakes({ files: goodFiles });
    const loadEngine = createEngineLoader(ENGINE);
    const [a, b] = await Promise.all([loadEngine(), loadEngine()]);
    expect(a).toBe(b);
    expect(workers).toHaveLength(1);
    expect(workers[0].url).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    const init = workers[0].posted[0];
    expect(init.message.type).toBe('init');
    expect([...init.message.wasmBinary]).toEqual([...wasmBytes]);
    expect(init.transfer).toEqual([init.message.wasmBinary.buffer]);
    expect(await a.pageStats(0)).toMatchObject({ visibleChars: 40 });
    await expect(a.open(new Uint8Array([1, 2]), 'clave')).rejects.toMatchObject({ name: 'EngineError', code: 'password' });
  });

  it('open() transfers a copy, never the caller\'s buffer', async () => {
    const { workers } = installFakes({ files: goodFiles });
    const client = await createEngineLoader(ENGINE)();
    const bytes = new Uint8Array([1, 2, 3]);
    await client.open(bytes).catch(() => {});
    expect(bytes.byteLength).toBe(3);
    const { message, transfer } = workers[0].posted.at(-1);
    expect(transfer[0]).toBe(message.args[0].buffer);
    expect(transfer[0]).not.toBe(bytes.buffer);
  });

  it.each([
    ['worker hash mismatch', { ...goodFiles, [ENGINE.worker.url]: new TextEncoder().encode('alterado') }, 'hash'],
    ['wasm hash mismatch', { ...goodFiles, [ENGINE.wasm.url]: new Uint8Array([0, 97, 115, 109, 9]) }, 'hash'],
    ['fetch fails', { ...goodFiles, [ENGINE.wasm.url]: new TypeError('Failed to fetch') }, 'fetch'],
    ['HTTP 404', { [ENGINE.worker.url]: workerCode }, 'fetch']
  ])('%s → rejected, no worker started', async (_name, files, code) => {
    const { workers } = installFakes({ files });
    await expect(createEngineLoader(ENGINE)()).rejects.toMatchObject({ name: 'EngineError', code });
    expect(workers).toHaveLength(0);
  });

  it('wasm blocked inside the worker → rejected and the worker terminated', async () => {
    const { workers } = installFakes({ files: goodFiles, behaviour: 'wasm-blocked' });
    await expect(createEngineLoader(ENGINE)()).rejects.toMatchObject({ code: 'wasm' });
    expect(workers[0].terminated).toBe(true);
  });

  it('no WebAssembly in the page (e.g. iOS Lockdown) → rejected before any GET', async () => {
    const { fetchMock } = installFakes({ files: goodFiles });
    vi.stubGlobal('WebAssembly', undefined);
    await expect(createEngineLoader(ENGINE)()).rejects.toMatchObject({ code: 'wasm' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('init postMessage throws → rejected and the worker terminated', async () => {
    const { workers } = installFakes({ files: goodFiles, behaviour: 'clone-error' });
    await expect(createEngineLoader(ENGINE)()).rejects.toMatchObject({ code: 'worker' });
    expect(workers[0].terminated).toBe(true);
  });

  it('a call with no answer in time (PDFium hung) → timeout, worker terminated, next load starts fresh', async () => {
    const { workers } = installFakes({ files: goodFiles });
    const loadEngine = createEngineLoader(ENGINE);
    const client = await loadEngine();
    vi.useFakeTimers();
    try {
      const hung = client.close(); // el worker falso no responde a 'close'
      const other = client.pageStats(0); // esta sí responde antes del plazo
      await vi.advanceTimersByTimeAsync(0);
      await expect(other).resolves.toMatchObject({ visibleChars: 40 });
      vi.advanceTimersByTime(10_000);
      await expect(hung).rejects.toMatchObject({ code: 'timeout' });
      expect(workers[0].terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(await loadEngine()).not.toBe(client);
  });

  it('worker crash on start → rejected; outside a build (ENGINE null) → unavailable', async () => {
    installFakes({ files: goodFiles, behaviour: 'crash' });
    await expect(createEngineLoader(ENGINE)()).rejects.toMatchObject({ code: 'worker' });
    await expect(createEngineLoader(null)()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(createEngineLoader({ ...ENGINE, wasm: { url: 'https://otro.example/x.wasm', sha256: ENGINE.wasm.sha256 } })()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('a failed load can be retried; terminate() rejects pending calls and the next load starts fresh', async () => {
    const files = { ...goodFiles, [ENGINE.wasm.url]: new TypeError('offline') };
    const { workers } = installFakes({ files });
    const loadEngine = createEngineLoader(ENGINE);
    await expect(loadEngine()).rejects.toBeInstanceOf(EngineError);
    files[ENGINE.wasm.url] = wasmBytes;
    const client = await loadEngine();
    const pending = client.close();
    client.terminate();
    await expect(pending).rejects.toMatchObject({ code: 'terminated' });
    await expect(client.pageStats(0)).rejects.toMatchObject({ code: 'terminated' });
    expect(client.alive).toBe(false);
    expect(workers[0].terminated).toBe(true);
    const next = await loadEngine();
    expect(next).not.toBe(client);
    expect(workers).toHaveLength(2);
  });
});

describe('ADR-004: engine stays out of the page', () => {
  const sources = readdirSync(join(root, 'src'), { recursive: true })
    .filter((name) => /\.(jsx?|mjs)$/.test(name))
    .map((name) => ({ path: relative(root, join(root, 'src', name)).replaceAll('\\', '/'), code: readFileSync(join(root, 'src', name), 'utf8') }));

  it('exactly one fetch( in src/, in the loader, and it is a GET', () => {
    const calls = sources.flatMap(({ path, code }) => [...code.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => ({ path, args: m[1] })));
    expect(calls.map((c) => c.path), 'ADR-004: engine stays out of the page').toEqual(['src/model/engine/loader.js']);
    expect(calls[0].args).toMatch(/method:\s*'GET'/);
    const mentions = sources.filter(({ path, code }) => path !== 'src/model/engine/loader.js' && /\bfetch\b/.test(code)).map((s) => s.path);
    expect(mentions, 'ADR-004: engine stays out of the page').toEqual([]); // ni globalThis.fetch ni self.fetch
  });

  it('no other way to send bytes out of the page in src/ (S6)', () => {
    const other = /\b(XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b|new\s+Request\s*\(/;
    expect(sources.filter(({ code }) => other.test(code)).map((s) => s.path), 'ADR-004: engine stays out of the page').toEqual([]);
  });

  it('nothing outside src/engine-worker/ imports @embedpdf/ or the worker', () => {
    const offenders = sources
      .filter(({ path }) => !path.startsWith('src/engine-worker/'))
      .filter(({ code }) => /from\s+['"][^'"]*(@embedpdf\/|engine-worker)/.test(code) || /import\(\s*['"][^'"]*(@embedpdf\/|engine-worker)/.test(code))
      .map(({ path }) => path);
    expect(offenders, 'ADR-004: engine stays out of the page').toEqual([]);
  });
});
