// @vitest-environment node
// restoreLayout (T13): espejo de protect.test.js. PDFium real en el proceso, pdf.js real en la verificación.
// Un PDF con etiquetas vuelve con los valores en su sitio, o se rechaza como LayoutRefused (nunca bytes sin verificar).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { createPdfium, PdfiumFault } from '../src/engine-worker/pdfium.js';
import { EngineError } from '../src/model/engine/loader.js';
import { protectLayout, MAX_LAYOUT_BYTES } from '../src/model/layout/protect.js';
import { restoreLayout } from '../src/model/layout/restore.js';
import { LayoutRefused } from '../src/model/layout/errors.js';
import { verifyRestored } from '../src/model/layout/verify.js';
import { getDocument } from 'pdfjs-dist';
import { PDFDocument, StandardFonts } from 'pdf-lib';

vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));
vi.mock('virtual:minoscreto-engine', () => ({ ENGINE: null }));

const root = resolve(__dirname, '..');
const fixture = (name) => new Uint8Array(readFileSync(join(root, 'tests/fixtures', name)));
const json = (name) => JSON.parse(readFileSync(join(root, 'tests/fixtures', name), 'utf8'));
const TABLA = json('tabla_sintetico.json');
const ENTITIES = Object.entries(TABLA).map(([tag, value], i) => ({ id: `e${i}`, type: tag.slice(1, -1).split('_')[0], value, aliases: [], label: tag.slice(1, -1), enabled: true }));
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

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
const collapse = (text) => text.replace(/\s+/g, ' ').trim();
// pdf.js une los objetos de texto con un espacio: «Gómez .» se lee «Gómez.»
const tight = (text) => collapse(text).replace(/ ([.,)])/g, '$1');

let runtime;
beforeAll(async () => {
  runtime = await createPdfRuntime({ prefer: 'wasm' });
});

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

const refusal = (promise) => promise.then(() => { throw new Error('no rechazó'); }, (error) => error);

// Color de relleno del primer carácter de `needle` en la página 1, leído con PDFium del PDF ya guardado.
function fillOf(bytes, needle) {
  const { fn, mem } = runtime;
  createPdfium(runtime); // deja la biblioteca iniciada
  const ptr = mem.alloc(bytes.length);
  mem.writeBytes(ptr, bytes);
  const doc = fn.FPDF_LoadMemDocument64(ptr, bytes.length, '');
  const page = fn.FPDF_LoadPage(doc, 0);
  const textPage = fn.FPDFText_LoadPage(page);
  const slots = [0, 1, 2, 3].map(() => mem.alloc(4));
  try {
    const n = fn.FPDFText_CountChars(textPage);
    let text = '';
    for (let i = 0; i < n; i++) text += String.fromCodePoint(fn.FPDFText_GetUnicode(textPage, i) || 32);
    const at = text.indexOf(needle);
    expect(at).toBeGreaterThanOrEqual(0);
    const obj = fn.FPDFText_GetTextObject(textPage, at);
    expect(fn.FPDFPageObj_GetFillColor(obj, ...slots)).toBeTruthy();
    return slots.map((s) => Number(mem.peek(s, 'i32')));
  } finally {
    slots.forEach((s) => mem.free(s));
    fn.FPDFText_ClosePage(textPage);
    fn.FPDF_ClosePage(page);
    fn.FPDF_CloseDocument(doc);
    mem.free(ptr);
  }
}

describe('restoreLayout (T13)', () => {
  it.each(['tabla_sintetico.pdf', 'prosa_sintetico.pdf'])('round trip on our protect output of %s: every value back in place', async (name) => {
    const original = fixture(name);
    const { loadEngine } = engineFor();
    const protectedPdf = await protectLayout({ bytes: original, entities: ENTITIES, loadEngine });
    const progress = [];
    const out = await restoreLayout({ bytes: protectedPdf.bytes, dict: TABLA, loadEngine, onProgress: (p) => progress.push(p.phase) });
    const [before, after] = [await pageTexts(original), await pageTexts(out.bytes)];
    expect(after.map(tight)).toEqual(before.map(tight)); // prosa: un vecino pisado por la etiqueta (`).`) se vuelve a poner
    for (const tag of Object.keys(TABLA)) expect(after.join(' ')).not.toContain(tag);
    expect(await verifyRestored(out.bytes, TABLA)).toEqual({ ok: true });
    expect(out.imagePages).toEqual([]);
    expect(progress[0]).toBe('engine');
    expect(progress.at(-1)).toBe('verify');
  });

  it('AI answer: values on the right lines, none of the known tags left, the generic one stays', async () => {
    const dict = json('respuesta_ia_sintetico.json');
    const { loadEngine } = engineFor();
    const out = await restoreLayout({ bytes: fixture('respuesta_ia_sintetico.pdf'), dict, loadEngine });
    const [one, two] = (await pageTexts(out.bytes)).map(tight);
    for (const line of [
      'Resumen del caso de Ana María Pérez Gómez ante el juzgado',
      'La demandante Ana María Pérez Gómez vive en Calle 45 # 12-30, Barrio Los Ángeles y trabaja para Construcciones Bahía S.A.S. desde 2019.',
      'El apoderado Pedro Núñez Castaño presentó la solicitud con la cédula 1.047.123.456 ante el despacho.',
      'Se notificó personalmente a Ana María Pérez Gómez.',
      'La empresa Construcciones Bahía S.A.S., con NIT 900.123.456-7, respondió el requerimiento a tiempo.',
      'Nota del asistente: contacte a Marta Peña para confirmar los datos antes de firmar.',
      'Ejemplo genérico: use [PERSONA_N] para cualquier persona no identificada.'
    ]) expect(one).toContain(line);
    expect(one).toContain('Ana María Pérez Gómez 1.047.123.456 Construcciones Bahía S.A.S.');
    expect(one).toContain('Pedro Núñez Castaño 900.123.456-7 Construcciones Bahía S.A.S.');
    expect(two).toContain('El señor Pedro Núñez Castaño confirmó que Ana María Pérez Gómez firmó el contrato en su presencia.');
    expect(two).toContain('Dirección de notificación: Calle 45 # 12-30, Barrio Los Ángeles.');
    for (const tag of Object.keys(dict)) expect(`${one} ${two}`).not.toContain(tag);
  });

  it('colour: our green tags come back black; the AI own grey is kept', async () => {
    const { loadEngine } = engineFor();
    const protectedPdf = await protectLayout({ bytes: fixture('prosa_sintetico.pdf'), entities: ENTITIES, loadEngine });
    expect(fillOf(protectedPdf.bytes, '[PERSONA_1]').slice(0, 3)).toEqual([13, 92, 74]);
    const back = await restoreLayout({ bytes: protectedPdf.bytes, dict: TABLA, loadEngine });
    expect(fillOf(back.bytes, 'Ana María Pérez Gómez')).toEqual([0, 0, 0, 255]);

    const ai = await restoreLayout({ bytes: fixture('respuesta_ia_sintetico.pdf'), dict: json('respuesta_ia_sintetico.json'), loadEngine });
    expect(fillOf(ai.bytes, 'Marta Peña').slice(0, 3)).toEqual([64, 64, 64]);
    expect(fillOf(ai.bytes, 'Pedro Núñez Castaño').slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('tag split across lines → missed-value, no bytes', async () => {
    const dict = Object.fromEntries(json('etiquetas_fin_de_linea_sintetico.json').keys.map((k, i) => [k, `Valor Inventado ${i}`]));
    const { loadEngine } = engineFor();
    const error = await refusal(restoreLayout({ bytes: fixture('etiquetas_fin_de_linea_sintetico.pdf'), dict, loadEngine }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe('missed-value');
  });

  it('a value too long or empty is not drawn: the tag stays and verification refuses', async () => {
    const { loadEngine } = engineFor();
    for (const value of ['x'.repeat(501), '   ']) {
      const error = await refusal(restoreLayout({ bytes: fixture('respuesta_ia_sintetico.pdf'), dict: { ...json('respuesta_ia_sintetico.json'), '[PERSONA_1]': value }, loadEngine }));
      expect(error.reason).toBe('missed-value');
    }
  });

  describe('engine checkNeedles in restore mode', () => {
    const edit = (needles, mode = 'restore') => {
      const pdfium = createPdfium(runtime);
      pdfium.open(fixture('respuesta_ia_sintetico.pdf'));
      try {
        return pdfium.editPage(0, { mode, needles });
      } finally {
        pdfium.close();
      }
    };
    it.each([
      ['value that is not a tag', [{ value: 'Ana', put: 'x' }], 'value'],
      ['put with a line break', [{ value: '[PERSONA_1]', put: 'a\nb' }], 'put'],
      ['put outside WinAnsi', [{ value: '[PERSONA_1]', put: '漢' }], 'put'],
      ['empty put', [{ value: '[PERSONA_1]', put: '' }], 'put'],
      ['put too long', [{ value: '[PERSONA_1]', put: 'x'.repeat(501) }], 'put'],
      ['edge needle', [{ value: '[PERSONA_1]', put: 'x', edge: 'end' }], 'edge'],
      ['context', [{ value: '[PERSONA_1]', put: 'x', context: 'y' }], 'context'],
      ['not an array', 'x', 'needles']
    ])('%s → bad-input', (_, needles, detail) => {
      let error;
      try { edit(needles); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(PdfiumFault);
      expect(error.code).toBe('bad-input');
      expect(error.message).toContain(detail);
    });
    it('unknown mode → bad-input', () => {
      expect(() => edit([], 'borrar')).toThrow(/bad-input: mode/);
    });
  });

  it('more than 80 MB → too-large without loading the engine', async () => {
    const loadEngine = vi.fn();
    const error = await refusal(restoreLayout({ bytes: new Uint8Array(MAX_LAYOUT_BYTES + 1), dict: TABLA, loadEngine }));
    expect(error.reason).toBe('too-large');
    expect(loadEngine).not.toHaveBeenCalled();
  });

  it('bad input is a TypeError', async () => {
    const bytes = fixture('tabla_sintetico.pdf');
    await expect(restoreLayout({ bytes: new Uint8Array(0), dict: TABLA })).rejects.toThrow(TypeError);
    await expect(restoreLayout({ bytes, dict: [] })).rejects.toThrow(TypeError);
    await expect(restoreLayout({ bytes, dict: null })).rejects.toThrow(TypeError);
    await expect(restoreLayout({ bytes, dict: TABLA, password: 5 })).rejects.toThrow(TypeError);
  });

  it('engine that will not load → engine', async () => {
    const error = await refusal(restoreLayout({ bytes: fixture('tabla_sintetico.pdf'), dict: TABLA, loadEngine: () => Promise.reject(new EngineError('hash', '/engine/x')) }));
    expect(error).toBeInstanceOf(LayoutRefused);
    expect(error.reason).toBe('engine');
  });

  it('abort between pages → AbortError, not a refusal; document closed, nothing saved', async () => {
    const controller = new AbortController();
    const { loadEngine, calls } = engineFor();
    const onProgress = (p) => { if (p.phase === 'edit' && p.done === 1) controller.abort(); };
    const error = await refusal(restoreLayout({ bytes: fixture('respuesta_ia_sintetico.pdf'), dict: json('respuesta_ia_sintetico.json'), loadEngine, onProgress, signal: controller.signal }));
    expect(error).not.toBeInstanceOf(LayoutRefused);
    expect(error.name).toBe('AbortError');
    expect(calls).not.toContain('save');
    expect(calls.at(-1)).toBe('close');
  });

  it('a scan page → scan before any edit', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawImage(await doc.embedPng(PNG_1PX), { x: 0, y: 0, width: 595, height: 842 });
    const { loadEngine, calls } = engineFor();
    const error = await refusal(restoreLayout({ bytes: await doc.save({ useObjectStreams: false }), dict: TABLA, loadEngine }));
    expect(error.reason).toBe('scan');
    expect(error.pages).toEqual([1]);
    expect(calls).not.toContain('editPage');
  });

  it('protect and restore share one turn queue: each document closes before the next opens', async () => {
    const { loadEngine, calls } = engineFor();
    const protectedPdf = await protectLayout({ bytes: fixture('tabla_sintetico.pdf'), entities: ENTITIES, loadEngine });
    calls.length = 0;
    await Promise.all([
      restoreLayout({ bytes: protectedPdf.bytes, dict: TABLA, loadEngine }),
      protectLayout({ bytes: fixture('prosa_sintetico.pdf'), entities: ENTITIES, loadEngine }),
      restoreLayout({ bytes: protectedPdf.bytes, dict: TABLA, loadEngine })
    ]);
    const lifecycle = calls.filter((c) => c === 'open' || c === 'close');
    expect(lifecycle).toEqual(['open', 'close', 'open', 'close', 'open', 'close']);
  });
});
