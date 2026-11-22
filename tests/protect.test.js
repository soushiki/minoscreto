// @vitest-environment node
// protectLayout (T10): el flujo entero con PDFium real dentro del proceso (sin worker) y pdf.js real en la
// verificación. Escaneo, valor partido, motor caído y archivo enorme salen como LayoutRefused; nunca hay bytes
// sin verificar.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createPdfium } from '../src/engine-worker/pdfium.js';
import { EngineError } from '../src/model/engine/loader.js';
import { protectLayout, MAX_LAYOUT_BYTES } from '../src/model/layout/protect.js';
import { LayoutRefused, refusalFrom } from '../src/model/layout/errors.js';
import { verifyProtected } from '../src/model/layout/verify.js';
import { getDocument } from 'pdfjs-dist';

// Texto de cada página leído con pdf.js (lo que vería quien recibe el archivo).
async function pageTexts(bytes) {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  await doc.cleanup?.();
  return pages;
}

vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));
// El virtual del build no existe en las pruebas; el cargador real no se usa aquí.
vi.mock('virtual:minoscreto-engine', () => ({ ENGINE: null }));
vi.mock('../src/model/layout/verify.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, verifyProtected: vi.fn(actual.verifyProtected) };
});

const root = resolve(__dirname, '..');
const fixture = (name) => new Uint8Array(readFileSync(join(root, 'tests/fixtures', name)));
const entity = (id, label, value, enabled = true, aliases = []) => ({ id, type: label.split('_')[0], value, aliases, label, enabled });
const ENTITIES = Object.entries(JSON.parse(readFileSync(join(root, 'tests/fixtures/tabla_sintetico.json'), 'utf8')))
  .map(([tag, value], i) => entity(`e${i}`, tag.slice(1, -1), value));
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

let runtime;
beforeAll(async () => {
  runtime = await createPdfRuntime({ prefer: 'wasm' });
});

// Un EngineClient como el del cargador, pero sobre PDFium en el mismo proceso; `fault` cambia un método.
function engineFor({ fault = {} } = {}) {
  const pdfium = createPdfium(runtime);
  const calls = [];
  const wrap = (name, run) => async (...args) => {
    calls.push(name);
    if (fault[name]) throw fault[name];
    return run(...args);
  };
  const client = {
    open: wrap('open', (bytes, password) => pdfium.open(new Uint8Array(bytes), password)),
    pageStats: wrap('pageStats', (p) => pdfium.pageStats(p)),
    editPage: wrap('editPage', (p, options) => pdfium.editPage(p, options)),
    save: wrap('save', () => pdfium.save()),
    close: wrap('close', () => pdfium.close()),
    alive: true
  };
  return { loadEngine: async () => client, calls };
}

async function makePdf(draw) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(PNG_1PX);
  const page = doc.addPage([595, 842]);
  draw({ page, font, png });
  return doc.save({ useObjectStreams: false });
}

const refusal = (promise) => promise.then(() => { throw new Error('no rechazó'); }, (error) => error);

describe('protectLayout (T10)', () => {
  it('table: every value replaced in place, verified, no image pages', async () => {
    const { loadEngine, calls } = engineFor();
    const progress = [];
    const out = await protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine, onProgress: (p) => progress.push(p) });

    expect(out.imagePages).toEqual([]);
    const text = (await pageTexts(out.bytes)).join('\n');
    for (const e of ENTITIES) expect(text).not.toContain(e.value);
    expect(text).toContain('[PERSONA_1]');
    expect(text).toContain('[NIT_3]');
    // La verificación vio exactamente los bytes que se devuelven.
    const verified = verifyProtected.mock.calls.at(-1);
    expect(verified[0]).toBe(out.bytes);
    expect(await verifyProtected(out.bytes, ENTITIES)).toEqual({ ok: true });
    expect(calls.at(-1)).toBe('close');
    expect(progress.map((p) => p.phase)).toEqual(['engine', 'scan', 'scan', 'edit', 'edit', 'save', 'verify', 'verify']);
    expect(progress.at(-1)).toEqual({ phase: 'verify', done: 1, total: 1 });
  });

  it('a page with a logo and real text is protected and listed in imagePages', async () => {
    const bytes = await makePdf(({ page, font, png }) => {
      page.drawImage(png, { x: 40, y: 760, width: 80, height: 40 });
      page.drawText('Demandante: Ana María Pérez Gómez, cédula 1.047.123.456, en Cartagena.', { x: 60, y: 700, size: 11, font });
    });
    const { loadEngine } = engineFor();
    const out = await protectLayout({ bytes, entities: ENTITIES, loadEngine });
    expect(out.imagePages).toEqual([1]);
    expect((await pageTexts(out.bytes))[0]).toContain('[PERSONA_1]');
  });

  it('scan (full-page image, no text) → scan before any edit', async () => {
    const bytes = await makePdf(({ page, png }) => page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 }));
    const { loadEngine, calls } = engineFor();
    const error = await refusal(protectLayout({ bytes, entities: ENTITIES, loadEngine }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe('scan');
    expect(error.pages).toEqual([1]);
    expect(calls).not.toContain('editPage');
    expect(calls).not.toContain('save');
    expect(calls.at(-1)).toBe('close');
  });

  it('value split across lines → missed-value, no bytes', async () => {
    const { loadEngine, calls } = engineFor();
    const error = await refusal(protectLayout({ bytes: fixture('valor_partido_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe('missed-value');
    expect(calls).toContain('save');
  });

  it('engine that will not load → engine, the input untouched', async () => {
    const bytes = fixture('tabla_sintetico.pdf');
    const before = bytes.slice();
    const error = await refusal(protectLayout({ bytes, entities: ENTITIES, loadEngine: () => Promise.reject(new EngineError('hash', '/engine/x')) }));
    expect(error.reason).toBe('engine');
    expect(error.cause).toBeInstanceOf(EngineError);
    expect(bytes).toEqual(before);
  });

  it.each([
    ['editPage', new EngineError('timeout', 'editPage'), 'engine'],
    ['editPage', Object.assign(new Error('font'), { code: 'font' }), 'engine'],
    ['save', Object.assign(new Error('poisoned'), { code: 'poisoned' }), 'engine'],
    ...['redact', 'anchor', 'insert', 'generate', 'nested', 'page'].map((code) => ['editPage', Object.assign(new Error(code), { code }), 'engine']),
    ['save', Object.assign(new Error('save'), { code: 'save' }), 'engine'],
    ['editPage', Object.assign(new Error('bad-input'), { code: 'bad-input' }), 'error'],
    ['open', Object.assign(new Error('too-large'), { code: 'too-large' }), 'too-large'],
    ['open', Object.assign(new Error('open'), { code: 'open' }), 'error'],
    ['pageStats', new TypeError('classifyPage: datos de página inválidos'), 'error']
  ])('%s fails with %s → %s, document closed when opened', async (method, fault, reason) => {
    const { loadEngine, calls } = engineFor({ fault: { [method]: fault } });
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe(reason);
    expect(error.cause).toBe(fault);
    if (method !== 'open') expect(calls.at(-1)).toBe('close');
    else expect(calls).not.toContain('close');
  });

  it('a dead engine is not asked to close', async () => {
    const { loadEngine, calls } = engineFor({ fault: { editPage: new EngineError('timeout', 'editPage') } });
    const client = await loadEngine();
    client.alive = false;
    await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(calls).not.toContain('close');
  });

  it('more than 80 MB → too-large without loading the engine', async () => {
    const loadEngine = vi.fn();
    const error = await refusal(protectLayout({ bytes: new Uint8Array(MAX_LAYOUT_BYTES + 1), entities: ENTITIES, loadEngine }));
    expect(error.reason).toBe('too-large');
    expect(loadEngine).not.toHaveBeenCalled();
  });

  it('password PDF: opens with the password and comes out without encryption', async () => {
    const { loadEngine } = engineFor();
    const entities = [entity('x', 'PERSONA_1', 'Laura Patricia Ortega Jiménez')];
    const out = await protectLayout({ bytes: fixture('contrasena_usuario_sintetico.pdf'), password: 'minoscreto-prueba', entities, loadEngine });
    expect(await PDFDocument.load(out.bytes)).toBeTruthy(); // pdf-lib no abre un PDF cifrado
    const wrong = await refusal(protectLayout({ bytes: fixture('contrasena_usuario_sintetico.pdf'), password: 'mala', entities, loadEngine }));
    expect(wrong.reason).toBe('error');
    expect(wrong.where).toBe('password');
  });

  it('verify fails → refused, never the bytes', async () => {
    verifyProtected.mockResolvedValueOnce({ ok: false, reason: 'error', where: 'revisions' });
    const { loadEngine } = engineFor();
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(error.reason).toBe('error');
    expect(error.where).toBe('revisions');
  });

  it('save that returns no bytes → engine, document closed', async () => {
    const { loadEngine, calls } = engineFor();
    const client = await loadEngine();
    client.save = async () => new ArrayBuffer(8);
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(error.reason).toBe('engine');
    expect(error.where).toBe('save');
    expect(calls.at(-1)).toBe('close');
  });

  it.each([
    [Object.assign(new Error('x'), { code: 'too-large' }), 'too-large'],
    [new TypeError('config'), 'error']
  ])('engine load fails with %s → %s', async (fault, reason) => {
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine: () => Promise.reject(fault) }));
    expect(error.reason).toBe(reason);
  });

  it('verify that returns nothing → refused as error', async () => {
    verifyProtected.mockResolvedValueOnce(undefined);
    const { loadEngine } = engineFor();
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe('error');
  });

  it('cancel while verify fails → AbortError, not a refusal', async () => {
    const controller = new AbortController();
    verifyProtected.mockImplementationOnce(async () => { controller.abort(); throw new Error('x'); });
    const { loadEngine } = engineFor();
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine, signal: controller.signal }));
    expect(error.name).toBe('AbortError');
  });

  it('verify that throws → refused as error, never the bytes', async () => {
    verifyProtected.mockRejectedValueOnce(new TypeError('boom'));
    const { loadEngine } = engineFor();
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe('error');
    expect(error.where).toBe('verify');
  });

  it('two calls at once take turns on the one worker document', async () => {
    const { loadEngine, calls } = engineFor();
    const [a, b] = await Promise.all([
      protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine }),
      protectLayout({ bytes: fixture('prosa_sintetico.pdf'), entities: ENTITIES, loadEngine })
    ]);
    const opens = calls.flatMap((c, i) => (c === 'open' ? [i] : []));
    expect(calls.indexOf('close')).toBeLessThan(opens[1]);
    expect((await pageTexts(a.bytes)).join(' ')).toContain('[NIT_3]');
    expect((await pageTexts(b.bytes)).join(' ')).toContain('[PERSONA_1]');
  });

  it('a call cancelled while waiting its turn rejects at once and never opens', async () => {
    const { loadEngine, calls } = engineFor();
    const controller = new AbortController();
    const first = protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine });
    const second = protectLayout({ bytes: fixture('prosa_sintetico.pdf'), entities: ENTITIES, loadEngine, signal: controller.signal });
    controller.abort();
    const error = await refusal(second);
    expect(error.name).toBe('AbortError');
    expect(calls).not.toContain('save'); // la primera aún no terminó
    await first;
    expect(calls.filter((c) => c === 'open')).toHaveLength(1);
  });

  it('a signal reused across calls does not keep a listener per call', async () => {
    const { loadEngine } = engineFor();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    await protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine, signal: controller.signal });
    await protectLayout({ bytes: fixture('prosa_sintetico.pdf'), entities: ENTITIES, loadEngine, signal: controller.signal });
    expect(added).toHaveBeenCalledTimes(2);
    expect(removed.mock.calls.map((c) => c[1])).toEqual(added.mock.calls.map((c) => c[1]));
  });

  it('abort between pages → AbortError (no fallback), nothing saved, document closed', async () => {
    const controller = new AbortController();
    const { loadEngine, calls } = engineFor();
    const onProgress = (p) => { if (p.phase === 'edit' && p.done === 1) controller.abort(); };
    const error = await refusal(protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine, onProgress, signal: controller.signal }));
    expect(error).not.toBeInstanceOf(LayoutRefused);
    expect(error.name).toBe('AbortError');
    expect(calls.filter((c) => c === 'editPage')).toHaveLength(1);
    expect(calls).not.toContain('save');
    expect(calls.at(-1)).toBe('close');
  });

  it('disabled entities are left in place', async () => {
    const { loadEngine } = engineFor();
    const entities = ENTITIES.map((e) => (e.label === 'PERSONA_1' ? { ...e, enabled: false } : e));
    const out = await protectLayout({ bytes: fixture('prosa_sintetico.pdf'), entities, loadEngine });
    const text = (await pageTexts(out.bytes)).join('\n');
    expect(text).toContain('Ana María Pérez Gómez');
    expect(text).not.toContain('[PERSONA_1]');
  });

  it('refusalFrom keeps a LayoutRefused and rejects unknown reasons', () => {
    const refused = new LayoutRefused('scan', { pages: [2] });
    expect(refusalFrom(refused)).toBe(refused);
    expect(() => new LayoutRefused('nope')).toThrow(TypeError);
  });
});
