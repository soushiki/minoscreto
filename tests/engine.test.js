// @vitest-environment node
// Motor PDFium (T4): worker (open / pageStats / close con PDFium real), cargador (hash, fetch, wasm bloqueado),
// y el fitness de ADR-004 sobre src/.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode, beginText, endText, setFontAndSize, setTextMatrix, showText } from 'pdf-lib';
import { createPdfium, flatten } from '../src/engine-worker/pdfium.js';
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

// pdf.js real (legacy en Node): líneas por altura, en el orden del flujo dentro de cada línea, o todo el flujo crudo.
async function pdfjsLines(bytes, { raw = false } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const byY = new Map();
    for (const item of (await (await doc.getPage(n)).getTextContent()).items) {
      if (!item.str.trim()) continue;
      const y = raw ? 0 : Math.round(item.transform[5]);
      byY.set(y, `${byY.get(y) ?? ''} ${item.str}`);
    }
    pages.push([...byY].sort((a, b) => b[0] - a[0]).map(([, line]) => tokens(line)));
  }
  await doc.cleanup?.();
  return pages;
}
const tokens = (line) => line.split(/\s+/).filter(Boolean).join(' ');
const tagged = (line, pairs) => tokens(pairs.reduce((out, [tag, value]) => out.split(value).join(` ${tag} `), line));

describe('engine worker: editPage protect + save (T9, ADR-008)', () => {
  const pairs = Object.entries(JSON.parse(readFileSync(join(root, 'tests/fixtures/tabla_sintetico.json'), 'utf8')))
    .sort((a, b) => b[1].length - a[1].length);
  const needles = pairs.map(([put, value]) => ({ value, put }));

  // Abre, protege todas las páginas, guarda y cierra; devuelve el PDF de salida. Todo puntero y página liberados.
  function protect(name, list = needles, password = '') {
    const counted = countingRuntime(runtime);
    const pdfium = createPdfium(counted.runtime);
    const { pageCount } = pdfium.open(fixture(name), password);
    const replaced = Array.from({ length: pageCount }, (_, p) => pdfium.editPage(p, { mode: 'protect', needles: list }).replaced);
    const out = pdfium.save();
    pdfium.close();
    expect(counted.live.size).toBe(0);
    expect(counted.opened).toEqual({ page: 0, text: 0 });
    return { out, replaced };
  }

  async function onePage(draw) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    draw(pdf.addPage([595, 842]), font);
    return pdf.save({ useObjectStreams: false });
  }

  it.each(['tabla_sintetico.pdf', 'prosa_sintetico.pdf'])('%s: every value gone, each tag in its place, line by line and in raw stream order', async (name) => {
    const { out, replaced } = protect(name);
    expect(replaced.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const expected = (pages) => pages.map((lines) => lines.map((line) => tagged(line, pairs)));
    // Una etiqueta pegada a la puntuación («[CEDULA_4]).») cuenta como separada: tagged() pone espacios a su alrededor.
    const spaced = (pages) => pages.map((lines) => lines.map((line) => tokens(line.replace(/\[[A-Z]+_\d+\]/g, ' $& '))));
    const after = await pdfjsLines(out);
    expect(spaced(after)).toEqual(expected(await pdfjsLines(fixture(name))));
    expect(spaced(await pdfjsLines(out, { raw: true }))).toEqual(expected(await pdfjsLines(fixture(name), { raw: true })));
    const text = after.flat().join('\n');
    for (const [, value] of pairs) expect(text).not.toContain(value);
    // PDFium la reabre y ya no encuentra ningún valor (redacción real, no un rectángulo encima).
    const again = createPdfium(runtime);
    again.open(out);
    for (let p = 0; p < replaced.length; p++) expect(again.editPage(p, { mode: 'protect', needles }).replaced).toBe(0);
    again.close();
  });

  it('a locked PDF: opened with its password, values replaced, saved without encryption', async () => {
    const list = [
      { value: 'Laura Patricia Ortega Jiménez', put: '[PERSONA_1]' },
      { value: '45.521.884', put: '[CEDULA_1]' },
      { value: '901.234.567-8', put: '[NIT_1]' }
    ];
    const { out, replaced } = protect('contrasena_usuario_sintetico.pdf', list, 'minoscreto-prueba');
    expect(replaced).toEqual([3]);
    expect(Buffer.from(out).toString('latin1')).not.toMatch(/\/Encrypt\b/);
    const reopened = createPdfium(runtime);
    expect(reopened.open(out).pageCount).toBe(1); // sin contraseña
    reopened.close();
    const lines = (await pdfjsLines(out))[0];
    expect(lines).toContain('Demandante: [PERSONA_1] , C.C. [CEDULA_1]');
    expect(lines.some((line) => line.includes('NIT [NIT_1]'))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/Laura Patricia|45\.521\.884|901\.234\.567-8/);
    // R9: una sola revisión, sin versiones antiguas con los datos reales
    const raw = Buffer.from(out).toString('latin1');
    expect(raw.match(/startxref/g)).toHaveLength(1);
    expect(raw.match(/%%EOF/g)).toHaveLength(1);
  });

  it('R2b: the redaction adds no covering boxes (no more fill/rectangle operators than the original)', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { OPS } = pdfjs;
    const counts = async (bytes) => {
      const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
      const watched = [OPS.rectangle, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.constructPath];
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { fnArray } = await (await doc.getPage(n)).getOperatorList();
        pages.push(Object.fromEntries(watched.map((op) => [op, fnArray.filter((f) => f === op).length])));
      }
      return pages;
    };
    const { out, replaced } = protect('tabla_sintetico.pdf');
    expect(replaced.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const before = await counts(fixture('tabla_sintetico.pdf'));
    const after = await counts(out);
    expect(after).toHaveLength(before.length);
    after.forEach((page, p) => {
      for (const op of Object.keys(page)) expect(page[op]).toBeLessThanOrEqual(before[p][op]);
    });
  });

  it('R2c: the redaction removes text only: a filled cell under a value keeps its whole fill (ADR-010)', async () => {
    const bytes = await onePage((page, font) => {
      page.setSize(400, 800);
      page.drawRectangle({ x: 50, y: 690, width: 300, height: 40, color: rgb(0.8, 0.8, 0.8) });
      page.drawLine({ start: { x: 50, y: 680 }, end: { x: 350, y: 680 }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawText('Juan Perez 123', { x: 60, y: 705, size: 12, font, color: rgb(0, 0, 0) });
      page.drawRectangle({ x: 200, y: 600, width: 50, height: 50, color: rgb(0.5, 0.5, 0.5) });
    });
    const { fn, mem } = runtime;
    fn.FPDF_InitLibrary();
    const slots = [0, 1, 2, 3].map(() => mem.alloc(4));
    // Abre con PDFium crudo: tipo, segmentos y límites de cada objeto de la página, y la imagen renderizada.
    const inspect = (pdf, probe) => {
      const ptr = mem.alloc(pdf.length);
      mem.writeBytes(ptr, pdf);
      const doc = fn.FPDF_LoadMemDocument64(ptr, pdf.length, '');
      const page = fn.FPDF_LoadPage(doc, 0);
      try {
        const objects = Array.from({ length: fn.FPDFPage_CountObjects(page) }, (_, i) => fn.FPDFPage_GetObject(page, i)).map((obj) => {
          const type = fn.FPDFPageObj_GetType(obj);
          fn.FPDFPageObj_GetBounds(obj, ...slots);
          const bounds = slots.map((s) => Math.round(Number(mem.peek(s, 'f32'))));
          return { type, segments: type === 2 ? fn.FPDFPath_CountSegments(obj) : 0, bounds: type === 2 ? bounds : null };
        });
        const tp = fn.FPDFText_LoadPage(page);
        let text = '';
        for (let i = 0, n = fn.FPDFText_CountChars(tp); i < n; i++) text += String.fromCodePoint(fn.FPDFText_GetUnicode(tp, i) || 63);
        fn.FPDFText_ClosePage(tp);
        const W = 400, H = 800;
        const bmp = fn.FPDFBitmap_Create(W, H, 0);
        fn.FPDFBitmap_FillRect(bmp, 0, 0, W, H, 0xffffffff);
        fn.FPDF_RenderPageBitmap(bmp, page, 0, 0, W, H, 0, 0);
        const buf = fn.FPDFBitmap_GetBuffer(bmp);
        const stride = fn.FPDFBitmap_GetStride(bmp);
        const px = (x, yPdf) => mem.readBytes(buf + BigInt((H - yPdf) * stride + x * 4), 4)[0];
        const pixels = probe.map(([x, y]) => px(x, y));
        fn.FPDFBitmap_Destroy(bmp);
        return { objects, text, pixels };
      } finally {
        fn.FPDF_ClosePage(page);
        fn.FPDF_CloseDocument(doc);
        mem.free(ptr);
      }
    };
    const probe = [[100, 692], [300, 716]]; // bajo la línea base de «Perez» y en otra parte de la celda
    const before = inspect(bytes, probe);
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    const { replaced } = pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Perez', put: '[PERSONA_1]' }] });
    const out = pdfium.save();
    pdfium.close();
    expect(replaced).toBe(1);
    const after = inspect(out, probe);
    expect(after.text).not.toContain('Perez');
    expect(after.text).toContain('[PERSONA_1]');
    const paths = (r) => r.objects.filter((o) => o.type === 2);
    expect(paths(after)).toEqual(paths(before)); // mismos trazos, segmentos y límites
    expect(after.objects.map((o) => o.type).filter((t) => t !== 1)).toEqual(before.objects.map((o) => o.type).filter((t) => t !== 1));
    // el cuadrado dibujado después del texto sigue después del texto
    const types = after.objects.map((o) => o.type);
    expect(types.lastIndexOf(2)).toBeGreaterThan(types.indexOf(1));
    expect(types.indexOf(2)).toBeLessThan(types.indexOf(1));
    // la celda conserva su gris donde estaba el valor (204), no queda un hueco blanco
    expect(before.pixels[0]).toBeGreaterThan(200);
    expect(after.pixels[0]).toBeGreaterThanOrEqual(201);
    expect(after.pixels[0]).toBeLessThanOrEqual(207);
    expect(after.pixels[1]).toBeGreaterThanOrEqual(201);
    expect(after.pixels[1]).toBeLessThanOrEqual(207);
  });

  it('R3a: the tag sits at the value\'s baseline and start, same height, brand colour, and extractable', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const value = '73.215.884';
    const tag = '[CEDULA_2]';
    const { out } = protect('tabla_sintetico.pdf');
    const items = async (bytes) => {
      const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
      const all = [];
      for (let n = 1; n <= doc.numPages; n++) all.push((await (await doc.getPage(n)).getTextContent()).items);
      return all;
    };
    const originalPages = await items(fixture('tabla_sintetico.pdf'));
    const outPages = await items(out);
    const p = originalPages.findIndex((list) => list.some((item) => item.str.includes(value)));
    expect(p).toBeGreaterThanOrEqual(0);
    const orig = originalPages[p].find((item) => item.str.includes(value));
    const moved = outPages[p].find((item) => item.str.includes(tag));
    expect(moved).toBeTruthy();
    expect(Math.abs(moved.transform[5] - orig.transform[5])).toBeLessThanOrEqual(1);
    // x de inicio del valor dentro de su objeto original frente a x de la etiqueta en el de salida
    const startX = (item, str, needle) => item.transform[4] + (item.width * str.indexOf(needle)) / str.length;
    expect(Math.abs(startX(moved, moved.str, tag) - startX(orig, orig.str, value))).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.height - orig.height) / orig.height).toBeLessThanOrEqual(0.15);
    // color: el relleno activo al mostrar la etiqueta es negro
    const doc = await pdfjs.getDocument({ data: out.slice(), verbosity: 0, isEvalSupported: false }).promise;
    const { OPS } = pdfjs;
    const { fnArray, argsArray } = await (await doc.getPage(p + 1)).getOperatorList();
    let fill = 'default';
    let shown = null;
    fnArray.forEach((fn, i) => {
      if (fn === OPS.setFillRGBColor) fill = String(argsArray[i]);
      else if (fn === OPS.setFillGray) fill = `gray:${argsArray[i]}`;
      else if (fn === OPS.setFillColor) fill = `c:${argsArray[i]}`;
      else if (fn === OPS.showText && argsArray[i][0].map((g) => g.unicode ?? '').join('').includes(tag)) shown ??= fill;
    });
    expect(shown).not.toBeNull();
    // la etiqueta va en negro, como el texto original (R3; usuario, 2026-11-24)
    expect(shown).toBe('#000000');
  });

  it('same rules as the gate: whole words only, longest first, accents and case folded', async () => {
    const bytes = await onePage((page, font) => {
      page.drawText('Mariana y Ana firmaron; ANA MARIA PEREZ también.', { x: 50, y: 700, size: 12, font });
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: [
      { value: 'Ana', put: '[PERSONA_2]' },
      { value: 'Ana María Pérez', put: '[PERSONA_1]' }
    ] })).toEqual({ replaced: 2 });
    const out = pdfium.save();
    pdfium.close();
    expect((await pdfjsLines(out))[0]).toEqual(['Mariana y [PERSONA_2] firmaron; [PERSONA_1] también.']);
  });

  it('a value split over two text objects on one line is replaced in place, the rest of the line kept', async () => {
    const head = 'Contra Ana María ';
    const bytes = await onePage((page, font) => {
      page.drawText(head, { x: 50, y: 700, size: 12, font });
      page.drawText('Pérez Gómez y otros', { x: 50 + font.widthOfTextAtSize(head, 12), y: 700, size: 12, font });
      page.drawText('Segunda línea intacta', { x: 50, y: 680, size: 12, font });
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    expect((await pdfjsLines(out))[0]).toEqual(['Contra [PERSONA_1] y otros', 'Segunda línea intacta']);
  });

  // Runtime real con una función de PDFium cambiada, para provocar fallos que una fixture no da.
  const patched = (overrides) => ({ mem: runtime.mem, fn: new Proxy(runtime.fn, { get: (target, key) => overrides[key]?.(target[key].bind(target)) ?? target[key] }) });
  const splitLine = () => onePage((page, font) => {
    page.drawText('Contra Ana María Pérez Gómez y otros', { x: 50, y: 700, size: 12, font });
  });

  it('a word that cannot be written back fails the page, and the half-edited document can no longer be saved', async () => {
    const pdfium = createPdfium(patched({ FPDFText_SetText: (real) => (obj, ptr) => (runtime.mem.readU16String(ptr) === 'otros' ? false : real(obj, ptr)) }));
    pdfium.open(await splitLine());
    const list = [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }];
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: list })).toThrow(expect.objectContaining({ code: 'font' }));
    expect(() => pdfium.save()).toThrow(expect.objectContaining({ code: 'poisoned' }));
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: list })).toThrow(expect.objectContaining({ code: 'poisoned' }));
    pdfium.close();
    pdfium.open(fixture('prosa_sintetico.pdf')); // un documento nuevo empieza limpio
    expect(pdfium.save()).toBeInstanceOf(Uint8Array);
    pdfium.close();
  });

  it('a failure before anything was erased does not poison the document', () => {
    const pdfium = createPdfium(runtime);
    pdfium.open(fixture('prosa_sintetico.pdf'));
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: 'x' })).toThrow(expect.objectContaining({ code: 'bad-input' }));
    expect(pdfium.save()).toBeInstanceOf(Uint8Array);
    pdfium.close();
  });

  it('a glyph without Unicode in a word to re-set → refused, never a shortened word', async () => {
    const pdfium = createPdfium(patched({ FPDFText_GetUnicode: (real) => (page, i) => (real(page, i) === 0x79 ? 0 : real(page, i)) })); // la «y»
    pdfium.open(await splitLine());
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] }))
      .toThrow(expect.objectContaining({ code: 'font' }));
    pdfium.close();
  });

  it('text lost outside the values (e.g. a neighbouring line clipped by the redaction) → lost-text', async () => {
    // La redacción quita también lo que se pone después: un tag que no llega a la página falta en el conteo.
    const pdfium = createPdfium(patched({ FPDFPage_InsertObjectAtIndex: (real) => (page, obj, at) => { real(page, obj, at); runtime.fn.FPDFPage_RemoveObject(page, obj); return true; } }));
    pdfium.open(await splitLine());
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] }))
      .toThrow(expect.objectContaining({ code: 'lost-text' }));
    expect(() => pdfium.save()).toThrow(expect.objectContaining({ code: 'poisoned' }));
    pdfium.close();
  });

  it('a redaction that creates a new object (an anchor could alias it) → anchor, document poisoned', async () => {
    const pdfium = createPdfium(patched({ EPDFPage_ApplyRedactions: (real) => (page, ...rest) => {
      const ok = real(page, ...rest);
      runtime.fn.FPDFPage_InsertObject(page, runtime.fn.FPDFPageObj_CreateNewRect(0, 0, 1, 1));
      return ok;
    } }));
    pdfium.open(await splitLine());
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] }))
      .toThrow(expect.objectContaining({ code: 'anchor' }));
    expect(() => pdfium.save()).toThrow(expect.objectContaining({ code: 'poisoned' }));
    pdfium.close();
  });

  it('tight leading (9 pt under 12 pt text): the line below the value keeps every character', async () => {
    const bytes = await onePage((page, font) => {
      page.drawText('Demandante Ana María Pérez Gómez contra', { x: 50, y: 700, size: 12, font });
      page.drawText('gjpqy línea de abajo muy pegada', { x: 50, y: 691, size: 12, font });
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    expect((await pdfjsLines(out))[0]).toEqual(['Demandante [PERSONA_1] contra', 'gjpqy línea de abajo muy pegada']);
  });

  it('very tight leading (lines ~3 pt apart, 7 pt text): the neighbouring line is rewritten, nothing lost', async () => {
    const bytes = await onePage((page, font) => {
      page.drawText('Ciclo POST 94 Pago', { x: 50, y: 700, size: 7, font });
      page.drawText('[24]Semana gjpqy Tiempos', { x: 50, y: 697, size: 7, font });
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'POST', put: '[NOMBRE_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    const text = (await pdfjsLines(out)).flat().join('');
    expect(text).toContain('[NOMBRE_1]');
    expect(text).not.toContain('POST');
    for (const ch of '[24]SemanagjpqyTiempos') expect(text).toContain(ch);
    expect([...text.replace(/\s/g, '')].sort()).toEqual([...'Ciclo[NOMBRE_1]94Pago[24]SemanagjpqyTiempos'].sort());
  });

  it('very tight leading, three lines ~3 pt apart: every lower line survives', async () => {
    const bytes = await onePage((page, font) => {
      page.drawText('Ciclo POST 94 Pago', { x: 50, y: 700, size: 7, font });
      page.drawText('[24]Semana gjpqy Tiempos', { x: 50, y: 697, size: 7, font });
      page.drawText('Tercera gjpqy linea', { x: 50, y: 694, size: 7, font });
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'POST', put: '[NOMBRE_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    const text = (await pdfjsLines(out)).flat().join('');
    expect(text).not.toContain('POST');
    expect([...text.replace(/\s/g, '')].sort()).toEqual([...'Ciclo[NOMBRE_1]94Pago[24]SemanagjpqyTiempos' + 'Terceragjpqylinea'].sort());
  });

  it('a word split at the line end (prese-/nciado) is re-set with its real hyphen, not PDFium\'s code 2', async () => {
    const bytes = await onePage((page, font) => {
      page.drawText('El testigo Ana María Pérez Gómez afirmó haber prese-', { x: 50, y: 700, size: 12, font });
      page.drawText('nciado la entrega de la mercancía', { x: 50, y: 686, size: 12, font });
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    expect((await pdfjsLines(out))[0]).toEqual(['El testigo [PERSONA_1] afirmó haber prese-', 'nciado la entrega de la mercancía']);
  });

  async function wrapped(lines, value) {
    const bytes = await onePage((page, font) => {
      lines.forEach((line, k) => page.drawText(line, { x: 50, y: 700 - 14 * k, size: 12, font }));
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    const result = pdfium.editPage(0, { mode: 'protect', needles: [{ value, put: '[PERSONA_1]' }] });
    const out = pdfium.save();
    pdfium.close();
    return { result, lines: await pdfjsLines(out) };
  }

  it('a name wrapped onto the next line (no hyphen) is replaced, tag on line 1, line 2 keeps every char', async () => {
    const { result, lines } = await wrapped(['El perito declaró Pedro Pablo', 'Henao Vélez que no vio nada', 'línea de abajo gjpqy'], 'Pedro Pablo Henao Vélez');
    expect(result).toEqual({ replaced: 1 });
    expect(lines[0]).toEqual(['El perito declaró [PERSONA_1]', 'que no vio nada', 'línea de abajo gjpqy']);
    expect(lines[0].join('')).not.toMatch(/Pedro|Henao|Vélez/);
  });

  it('a value hyphenated at the line end (Cár-/denas) is replaced, both pieces gone', async () => {
    const { result, lines } = await wrapped(['El acta la firmó Juan Cár-', 'denas ante el juez de turno'], 'Juan Cárdenas');
    expect(result).toEqual({ replaced: 1 });
    expect(lines[0]).toEqual(['El acta la firmó [PERSONA_1]', 'ante el juez de turno']);
  });

  it('a compound surname split at its hyphen with an uppercase next line (Gómez-/Pérez) is replaced', async () => {
    const { result, lines } = await wrapped(['Compareció la señora Lucía Gómez-', 'Pérez declaró bajo juramento', 'otra línea gjpqy'], 'Lucía Gómez-Pérez');
    expect(result).toEqual({ replaced: 1 });
    expect(lines[0]).toEqual(['Compareció la señora [PERSONA_1]', 'declaró bajo juramento', 'otra línea gjpqy']);
  });

  it('flatten: whitespace runs, code-2 hyphen without break, digit hyphen kept, at mapping', () => {
    const a = flatten([...'ab'], []);
    expect(a).toEqual({ text: 'ab', at: [0, 1] });
    const b = flatten(['a', ' ', '\r', '\n', 'b'], []);
    expect(b).toEqual({ text: 'a b', at: [0, 1, 4] });
    // código 2 (guion sin salto detrás) entre letra y minúscula: se une
    const c = flatten([...'Cár', '-', ...'denas'], Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0, 0]));
    expect(c.text).toBe('Cárdenas');
    expect(c.at).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    // guion + salto, cifra delante: se queda el guion y se quita el salto
    const d = flatten([...'1', '-', '\r', '\n', ...'50'], []);
    expect(d.text).toBe('1-50');
    expect(d.at).toEqual([0, 1, 4, 5]);
    // letra + guion + mayúscula: se queda el guion
    const e = flatten([...'Gómez', '-', '\r', '\n', ...'Pérez'], []);
    expect(e.text).toBe('Gómez-Pérez');
    expect(e.at[5]).toBe(5);
    // guion en medio de la línea, sin salto: pasa tal cual
    expect(flatten([...'a-b'], []).text).toBe('a-b');
  });

  it('a heading written later in the stream but drawn higher keeps its stream place (guard; PDFium reads in stream order)', async () => {
    // El encabezado se escribe después en el flujo pero va arriba en la página, y se borra entero.
    const bytes = await onePage((page, font) => {
      page.drawText('Demandante: Ana María Pérez Gómez y otros', { x: 50, y: 680, size: 12, font });
      page.drawText('Construcciones Bahía S.A.S.', { x: 50, y: 700, size: 12, font });
    });
    const list = [
      { value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' },
      { value: 'Construcciones Bahía S.A.S.', put: '[EMPRESA_1]' }
    ];
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    expect(pdfium.editPage(0, { mode: 'protect', needles: list })).toEqual({ replaced: 2 });
    const out = pdfium.save();
    pdfium.close();
    expect(await pdfjsLines(out, { raw: true })).toEqual([['Demandante: [PERSONA_1] y otros [EMPRESA_1]']]);
    expect((await pdfjsLines(out))[0]).toEqual(['[EMPRESA_1]', 'Demandante: [PERSONA_1] y otros']);
  });

  it('font size in the text matrix (Tf 1, Tm 12) shrinks the tag like Tf 12 does', async () => {
    const tagWidth = async (viaMatrix) => {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const page = pdf.addPage([595, 842]);
      const name = page.node.newFontDictionary(font.name, font.ref);
      const line = 'Firma Ana hoy';
      page.pushOperators(
        beginText(),
        setFontAndSize(name, viaMatrix ? 1 : 12),
        viaMatrix ? setTextMatrix(12, 0, 0, 12, 50, 700) : setTextMatrix(1, 0, 0, 1, 50, 700),
        showText(font.encodeText(line)),
        endText()
      );
      const pdfium = createPdfium(runtime);
      pdfium.open(await pdf.save({ useObjectStreams: false }));
      expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana', put: '[PERSONA_1]' }] })).toEqual({ replaced: 1 });
      const out = pdfium.save();
      pdfium.close();
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: out, verbosity: 0, isEvalSupported: false }).promise;
      const items = (await (await doc.getPage(1)).getTextContent()).items;
      // pdf.js une «Firma » (que queda en su objeto) con la etiqueta: se resta lo que mide «Firma ».
      return items.find((item) => item.str === 'Firma [PERSONA_1]').width - font.widthOfTextAtSize('Firma ', 12);
    };
    const viaTf = await tagWidth(false);
    const viaTm = await tagWidth(true);
    // «Ana» mide ~21 pt a 12 pt: la etiqueta (~79 pt) baja al piso del 60 % (~47 pt) en los dos casos.
    expect(viaTf).toBeGreaterThan(44);
    expect(viaTf).toBeLessThan(50);
    expect(viaTm).toBeCloseTo(viaTf, 0);
  });

  it('a value followed by a comma: the tag stops before the comma', async () => {
    const line = 'Llamar al 3001234567, o al 3007654321 hoy';
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    page.drawText(line, { x: 50, y: 700, size: 12, font });
    const pdfium = createPdfium(runtime);
    pdfium.open(await pdf.save({ useObjectStreams: false }));
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: '3001234567', put: '[TELEFONO_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: out, verbosity: 0, isEvalSupported: false }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((item) => item.str !== '');
    // pdf.js puede unir objetos: el borde derecho de la etiqueta es el inicio del texto que sigue («, o al …»), medido con la fuente.
    const tagItem = items.find((item) => item.str.includes('[TELEFONO_1]'));
    const rest = ', o al 3007654321 hoy';
    const restItem = items.find((item) => item.str.endsWith(rest));
    const restStart = restItem.transform[4] + restItem.width - font.widthOfTextAtSize(rest, 12);
    const tagEnd = tagItem === restItem ? restStart : tagItem.transform[4] + tagItem.width;
    const commaLeft = 50 + font.widthOfTextAtSize('Llamar al 3001234567', 12);
    expect(tagEnd).toBeLessThanOrEqual(commaLeft + 0.5); // la coma dibuja ~1 pt después de su origen: la holgura puede usar ese hueco (antes: +6,5 pt)
    expect(restStart).toBeCloseTo(commaLeft, 0);
  });

  it('a value with characters outside the basic plane is still found and replaced (𝐌)', async () => {
    const MATH_M = 0x1d40c; // 𝐌, dos unidades UTF-16 (la «M» no está en la etiqueta)
    const pdfium = createPdfium(patched({ FPDFText_GetUnicode: (real) => (page, i) => (real(page, i) === 0x4d ? MATH_M : real(page, i)) })); // «M» → 𝐌
    pdfium.open(await splitLine());
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana 𝐌aría Pérez Gómez', put: '[PERSONA_1]' }] })).toEqual({ replaced: 1 });
    const out = pdfium.save();
    pdfium.close();
    expect((await pdfjsLines(out))[0]).toEqual(['Contra [PERSONA_1] y otros']);
  });

  it('a value PDFium gives no box for is refused before anything is erased (never a silent 60 % tag)', async () => {
    const pdfium = createPdfium(patched({ FPDFText_CountRects: () => () => 0 }));
    pdfium.open(await splitLine());
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana María Pérez Gómez', put: '[PERSONA_1]' }] }))
      .toThrow(expect.objectContaining({ code: 'page' }));
    expect(pdfium.save()).toBeInstanceOf(Uint8Array); // nada se borró: el documento no queda envenenado
    pdfium.close();
  });

  // Trozos de un valor partido entre folios (T12c): `edge` 'end' = el último de la página, con etiqueta; 'start' = el primero, sin etiqueta.
  async function edged(lines, list) {
    const bytes = await onePage((page, font) => {
      lines.forEach((line, k) => page.drawText(line, { x: 50, y: 700 - 14 * k, size: 12, font }));
    });
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    const result = pdfium.editPage(0, { mode: 'protect', needles: list });
    const out = pdfium.save();
    pdfium.close();
    return { result, lines: (await pdfjsLines(out))[0] };
  }

  it("edge 'end' takes the last occurrence on the page and draws the tag", async () => {
    const { result, lines } = await edged(['Carlos habló primero. Luego el señor Carlos'], [{ value: 'Carlos', put: '[PERSONA_1]', edge: 'end' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['Carlos habló primero. Luego el señor [PERSONA_1]']);
  });

  it("edge 'start' takes the first occurrence, erases it and draws no tag", async () => {
    const { result, lines } = await edged(['Andrés Mendoza presentó la demanda. Andrés llegó'], [{ value: 'Andrés', put: '', edge: 'start' }]);
    expect(result).toEqual({ replaced: 0 });
    expect(lines).toEqual(['Mendoza presentó la demanda. Andrés llegó']);
    expect(lines.join('')).not.toContain('[');
  });

  it('an edge needle skips characters already taken by a normal needle', async () => {
    const { result, lines } = await edged(['Ana María Pérez firmó y Ana llegó'], [
      { value: 'Ana María Pérez', put: '[PERSONA_1]' },
      { value: 'Ana', put: '', edge: 'start' }
    ]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['[PERSONA_1] firmó y llegó']);
  });

  it("edge 'end' also erases the hyphen that ends the page (Rí-)", async () => {
    const { result, lines } = await edged(['Firma de Ana Rí-', 'Página 1 de 2'], [{ value: 'Ana Rí', put: '[PERSONA_1]', edge: 'end' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['Firma de [PERSONA_1]', 'Página 1 de 2']); // el pie de página sigue detrás del guion
  });

  it("edge 'start' with a context skips a header with the same name and erases the tail next to the break", async () => {
    const { lines } = await edged(['Proceso Pérez Gómez y otros', 'Pérez Gómez presentó la demanda'],
      [{ value: 'Pérez Gómez', put: '', edge: 'start', context: 'presentó la demanda' }]);
    expect(lines).toEqual(['Proceso Pérez Gómez y otros', 'presentó la demanda']);
  });

  it("edge 'end' with a context skips a later signature with the same name", async () => {
    const { result, lines } = await edged(['firmó la señora Ana', 'Firma: Ana'],
      [{ value: 'Ana', put: '[PERSONA_1]', edge: 'end', context: 'firmó la señora' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['firmó la señora [PERSONA_1]', 'Firma: Ana']);
  });

  it('a context that matches nowhere erases nothing', async () => {
    const { result, lines } = await edged(['firmó la señora Ana', 'Firma: Ana'],
      [{ value: 'Ana', put: '[PERSONA_1]', edge: 'end', context: 'otra frase distinta' }]);
    expect(result).toEqual({ replaced: 0 });
    expect(lines).toEqual(['firmó la señora Ana', 'Firma: Ana']);
  });

  it('a context matches whatever the line breaks and spaces between its words', async () => {
    const { result, lines } = await edged(['El acta que firmó la', 'señora    Ana'],
      [{ value: 'Ana', put: '[PERSONA_1]', edge: 'end', context: 'firmó  la señora ' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines.join(' ')).not.toContain('Ana');
    const tail = await edged(['Proceso Gómez', 'Gómez presentó', 'la demanda'], [{ value: 'Gómez', put: '', edge: 'start', context: 'presentó la demanda' }]);
    expect(tail.lines).toEqual(['Proceso Gómez', 'presentó', 'la demanda']);
  });

  it('a context is compared in the corrected view too (Gl0ria in the context)', async () => {
    const { result, lines } = await edged(['firmó Gl0ria Ana', 'Firma: Ana'],
      [{ value: 'Ana', put: '[PERSONA_1]', edge: 'end', context: 'firmó Gloria' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['firmó Gl0ria [PERSONA_1]', 'Firma: Ana']);
  });

  it('edge needles have their own cap (500 per page call); normal needles keep 5000', async () => {
    const bytes = await onePage((page, font) => page.drawText('Ana', { x: 50, y: 700, size: 12, font }));
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    const edge = (n) => Array.from({ length: n }, (_, i) => ({ value: `Nadie ${i}`, put: '', edge: 'start' }));
    expect(pdfium.editPage(0, { mode: 'protect', needles: edge(500) })).toEqual({ replaced: 0 });
    expect(pdfium.editPage(0, { mode: 'protect', needles: [...edge(500), ...Array.from({ length: 5000 }, (_, i) => ({ value: `Otro ${i}`, put: '[A_1]' }))] })).toEqual({ replaced: 0 });
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: edge(501) })).toThrow(expect.objectContaining({ code: 'bad-input' }));
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana', put: '[A_1]', context: 'x' }] })).toThrow(expect.objectContaining({ code: 'bad-input' }));
    expect(() => pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Ana', put: '', edge: 'end', context: 'x'.repeat(65) }] })).toThrow(expect.objectContaining({ code: 'bad-input' }));
    pdfium.close();
  });

  it('OCR digit typos: «Gl0ria» is matched like the gate sees it (Gloria), tag drawn, nothing left', async () => {
    const { result, lines } = await edged(['El señor Gl0ria Pérez firmó'], [{ value: 'Gloria Pérez', put: '[PERSONA_1]' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['El señor [PERSONA_1] firmó']);
    expect(lines.join('')).not.toMatch(/Gl0ria|Gloria/);
  });

  it('a raw match wins over an overlapping match in the corrected view', async () => {
    // Crudo: «Gl0ria Pérez» no coincide con «Gloria»; sí «Pérez Gómez». Vista corregida: «Gloria Pérez» solapa en «Pérez».
    const { result, lines } = await edged(['El señor Gl0ria Pérez Gómez firmó'], [
      { value: 'Pérez Gómez', put: '[PERSONA_2]' },
      { value: 'Gloria Pérez', put: '[PERSONA_1]' }
    ]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['El señor Gl0ria [PERSONA_2] firmó']);
  });

  it('a value mid-line («Ana Pérez Gómez firmó», needle Pérez Gómez) keeps the space after its tag', async () => {
    const { lines } = await edged(['El señor Ana Pérez Gómez firmó'], [{ value: 'Pérez Gómez', put: '[PERSONA_2]' }]);
    expect(lines).toEqual(['El señor Ana [PERSONA_2] firmó']);
  });

  it('an edge piece found only in the corrected view is erased too', async () => {
    const { result, lines } = await edged(['Firmó Gl0ria y luego Pedro'], [{ value: 'Gloria', put: '[PERSONA_1]', edge: 'end' }]);
    expect(result).toEqual({ replaced: 1 });
    expect(lines).toEqual(['Firmó [PERSONA_1] y luego Pedro']);
  });

  it('checkNeedles: an empty put needs an edge, and the edge must be end or start', async () => {
    const bytes = await onePage((page, font) => page.drawText('Ana', { x: 50, y: 700, size: 12, font }));
    const pdfium = createPdfium(runtime);
    pdfium.open(bytes);
    for (const bad of [{ value: 'Ana', put: '' }, { value: 'Ana', put: '', edge: 'middle' }, { value: 'Ana', put: '[A_1]', edge: 'x' }, { value: 'Ana', put: 'sin corchetes', edge: 'end' }]) {
      expect(() => pdfium.editPage(0, { mode: 'protect', needles: [bad] })).toThrow(expect.objectContaining({ code: 'bad-input' }));
    }
    pdfium.close();
  });

  it('a needle joined across a line as «Juan- Pérez» matches the wrap Juan- / Pérez', async () => {
    const { result, lines } = await wrapped(['Firmó el señor Juan-', 'Pérez ante el juez', 'otra línea gjpqy'], 'Juan- Pérez');
    expect(result).toEqual({ replaced: 1 });
    expect(lines[0]).toEqual(['Firmó el señor [PERSONA_1]', 'ante el juez', 'otra línea gjpqy']);
  });

  it('flatten: an inline soft hyphen between two letters is dropped (and mapped), one at a line break is not', () => {
    const shy = String.fromCharCode(0xad);
    const a = flatten(['M', 'a', shy, 'r', 'í', 'a'], []);
    expect(a.text).toBe('María');
    expect(a.at).toEqual([0, 1, 3, 4, 5]);
    expect(flatten(['a', shy, ' ', 'b'], []).text).toBe('a' + shy + 'b'.padStart(2, ' '));
  });

  it('a page without any value is left as it was', () => {
    const pdfium = createPdfium(runtime);
    pdfium.open(fixture('prosa_sintetico.pdf'));
    expect(pdfium.editPage(0, { mode: 'protect', needles: [{ value: 'Nadie Que Exista', put: '[PERSONA_9]' }] })).toEqual({ replaced: 0 });
    expect(pdfium.editPage(0, { mode: 'protect', needles: [] })).toEqual({ replaced: 0 });
    pdfium.close();
  });

  it('rejects bad calls without leaking', () => {
    const counted = countingRuntime(runtime);
    const pdfium = createPdfium(counted.runtime);
    const ok = { mode: 'protect', needles };
    expect(() => pdfium.editPage(0, ok)).toThrow(expect.objectContaining({ code: 'no-document' }));
    expect(() => pdfium.save()).toThrow(expect.objectContaining({ code: 'no-document' }));
    pdfium.open(fixture('tabla_sintetico.pdf'));
    expect(() => pdfium.editPage(7, ok)).toThrow(expect.objectContaining({ code: 'bad-page' }));
    for (const bad of [
      undefined,
      { mode: 'restore', needles },
      { mode: 'protect' },
      { mode: 'protect', needles: [{ value: ' ', put: '[A_1]' }] },
      { mode: 'protect', needles: [{ value: 'x'.repeat(501), put: '[A_1]' }] },
      { mode: 'protect', needles: [{ value: 'Ana', put: 'sin corchetes' }] },
      { mode: 'protect', needles: [{ value: 'Ana', put: '[DIRECCIÓN_1]' }] },
      { mode: 'protect', needles: [{ value: 'Ana', put: '[A]B]' }] },
      { mode: 'protect', needles: Array.from({ length: 5001 }, () => ({ value: 'Ana', put: '[A_1]' })) }
    ]) expect(() => pdfium.editPage(0, bad)).toThrow(expect.objectContaining({ code: 'bad-input' }));
    pdfium.close();
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

  it('editPage and save go through; the saved bytes are transferred, not copied', async () => {
    const tablaNeedles = Object.entries(JSON.parse(readFileSync(join(root, 'tests/fixtures/tabla_sintetico.json'), 'utf8'))).map(([put, value]) => ({ value, put }));
    const replies = [];
    const handle = createWorkerHandler((message, transfer = []) => replies.push({ message, transfer }), () => runtime);
    await handle({ data: { type: 'init', wasmBinary: new Uint8Array(0) } });
    await handle({ data: { type: 'call', id: 1, method: 'open', args: [fixture('prosa_sintetico.pdf'), ''] } });
    await handle({ data: { type: 'call', id: 2, method: 'editPage', args: [0, { mode: 'protect', needles: tablaNeedles }] } });
    const edited = replies.pop().message;
    expect(edited).toMatchObject({ type: 'result', id: 2, ok: true });
    expect(edited.result.replaced).toBeGreaterThan(0);
    await handle({ data: { type: 'call', id: 3, method: 'save', args: [] } });
    const { message, transfer } = replies.pop();
    expect(message).toMatchObject({ id: 3, ok: true });
    expect(message.result).toBeInstanceOf(Uint8Array);
    expect(transfer).toEqual([message.result.buffer]);
    await handle({ data: { type: 'call', id: 4, method: 'editPage', args: [0, { mode: 'protect', needles: 'x' }] } });
    expect(replies.pop().message).toMatchObject({ id: 4, ok: false, error: { code: 'bad-input' } });
    await handle({ data: { type: 'call', id: 5, method: 'close' } });
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
        if (message.method === 'editPage') reply({ type: 'result', id: message.id, ok: true, result: { replaced: 2 } });
        if (message.method === 'save') reply({ type: 'result', id: message.id, ok: true, result: new Uint8Array([37, 80, 68, 70]) });
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

  it('editPage sends only page, mode and needles; save answers the bytes; a page with no answer times out', async () => {
    const { workers } = installFakes({ files: goodFiles });
    const client = await createEngineLoader(ENGINE)();
    const needles = [{ value: 'Ana', put: '[PERSONA_1]' }];
    await expect(client.editPage(0, { mode: 'protect', needles, extra: 'no viaja' })).resolves.toEqual({ replaced: 2 });
    expect(workers[0].posted.at(-1).message).toMatchObject({ method: 'editPage', args: [0, { mode: 'protect', needles }] });
    expect(workers[0].posted.at(-1).message.args[1]).not.toHaveProperty('extra');
    expect([...await client.save()]).toEqual([37, 80, 68, 70]);
    vi.useFakeTimers();
    try {
      workers[0].postMessage = () => {}; // PDFium colgado en esta página
      const hung = client.editPage(1, { mode: 'protect', needles });
      vi.advanceTimersByTime(10_001);
      await expect(hung).rejects.toMatchObject({ code: 'timeout' });
      expect(workers[0].terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('editPage without options rejects through the worker instead of throwing in the caller', async () => {
    const { workers } = installFakes({ files: goodFiles });
    const client = await createEngineLoader(ENGINE)();
    let pending;
    expect(() => { pending = client.editPage(3); }).not.toThrow();
    await pending;
    expect(workers[0].posted.at(-1).message.args).toEqual([3, { mode: undefined, needles: undefined }]);
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
