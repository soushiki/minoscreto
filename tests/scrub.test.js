import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { scrubPdf, listTextualObjects, ALLOWED_CATALOG_KEYS, ALLOWED_PAGE_KEYS } from '../src/model/pdf/scrub.js';

const fixture = (name) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, 'fixtures', name)));
const VALUE = 'Laura Patricia Ortega Jiménez';

const latin1 = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf16be = (s) => Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]));
const hex = (s) => new TextEncoder().encode([...s].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(''));
const FORMS = [new TextEncoder().encode('Ortega'), latin1('Ortega'), utf16be('Ortega'), hex('Ortega')];
const contains = (hay, needle) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
const leaks = ({ strings, streams }) => [...strings, ...streams].filter((b) => FORMS.some((f) => contains(b, f)));
const raw = (bytes) => Buffer.from(bytes).toString('latin1');

describe('scrubPdf (S7)', () => {
  it('the dirty fixture really carries every part (sanity)', async () => {
    const bytes = fixture('sucio_sintetico.pdf');
    const found = await listTextualObjects(bytes);
    expect(found.forbidden).toEqual(expect.arrayContaining([
      'trailer/Info', 'catalog/Metadata', 'catalog/AcroForm', 'catalog/Outlines', 'catalog/Names',
      'catalog/OpenAction', 'catalog/AA', 'catalog/StructTreeRoot', 'catalog/MarkInfo', 'catalog/PieceInfo',
      'catalog/Info', 'catalog/PageMode',
    ]));
    expect(found.forbidden.some((k) => /^pagenode\d+\/Annots$/.test(k))).toBe(true);
    expect(found.forbidden.some((k) => /^pagenode\d+\/PieceInfo$/.test(k))).toBe(true);
    expect(leaks(found).length).toBeGreaterThan(3);
    expect(raw(bytes)).toContain('/ObjStm');
    expect(raw(bytes).match(/%%EOF/g).length).toBe(2);
  });

  it('removes Info, XMP, annots, form, outline, attachment, JavaScript, OpenAction, revisions, object streams', async () => {
    const out = await scrubPdf(fixture('sucio_sintetico.pdf'));
    const found = await listTextualObjects(out);
    expect(found.forbidden).toEqual([]);
    expect(leaks(found)).toEqual([]);
    const text = raw(out);
    for (const k of ['/ObjStm', '/XRef', '/JavaScript', '/EmbeddedFile', '/Annot', '/Widget', '/Metadata', '/Producer']) {
      expect(text, k).not.toContain(k);
    }
    expect(text.match(/%%EOF/g).length).toBe(1);
    expect(text).not.toMatch(/\/ID\s*\[/);
  });

  it('keeps the pages and their visible text', async () => {
    const out = await scrubPdf(fixture('sucio_sintetico.pdf'));
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    const { streams } = await listTextualObjects(out);
    const shown = streams.map((s) => raw(s)).join('\n');
    expect(shown).toContain(Buffer.from('Folio 1: texto visible').toString('hex')); // page text kept
    expect(doc.getPage(0).node.Contents()).toBeDefined();
    expect(doc.getPage(0).getMediaBox()).toMatchObject({ width: 612, height: 792 });
  });

  it('a clean pdf-lib file stays readable and lists its strings and streams', async () => {
    const src = await PDFDocument.create({ updateMetadata: false });
    const page = src.addPage([612, 792]);
    page.drawText('Texto Ortega', { x: 72, y: 700, font: await src.embedFont(StandardFonts.Helvetica) });
    const out = await scrubPdf(await src.save());
    const found = await listTextualObjects(out);
    expect(found.forbidden).toEqual([]);
    expect(leaks(found).length).toBe(1); // the page text itself (hex glyph codes), which the gate (T8) judges
    expect(found.undecoded).toEqual([]);
  });

  it('strips XMP from reachable non-catalog objects (image /Metadata)', async () => {
    const src = await PDFDocument.create({ updateMetadata: false });
    const page = src.addPage([200, 200]);
    const xmp = src.context.flateStream(`<x>${VALUE}</x>`, { Type: 'Metadata', Subtype: 'XML' });
    page.node.Resources().set(PDFName.of('Minoscreto'), src.context.obj({ Metadata: src.context.register(xmp) }));
    const out = await scrubPdf(await src.save());
    expect(leaks(await listTextualObjects(out))).toEqual([]);
  });

  it('counts streams it cannot decode instead of hiding them', async () => {
    const src = await PDFDocument.create({ updateMetadata: false });
    const page = src.addPage([200, 200]);
    const img = src.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'DCTDecode',
    });
    page.node.Resources().set(PDFName.of('XObject'), src.context.obj({ Im1: src.context.register(img) }));
    const found = await listTextualObjects(await scrubPdf(await src.save()));
    expect(found.undecoded).toEqual([{ filter: '/DCTDecode' }]);
  });

  it('a damaged stream with a known filter makes the listing fail (gate fails closed)', async () => {
    const src = await PDFDocument.create({ updateMetadata: false });
    const page = src.addPage([200, 200]);
    const bad = src.context.stream(new Uint8Array([1, 2, 3, 4, 5]), { Filter: 'FlateDecode' });
    page.node.Resources().set(PDFName.of('Minoscreto'), src.context.register(bad));
    await expect(listTextualObjects(await src.save())).rejects.toThrow();
  });

  it('rejects empty or non-byte input', async () => {
    await expect(scrubPdf(new Uint8Array())).rejects.toThrow(TypeError);
    await expect(listTextualObjects('x')).rejects.toThrow(TypeError);
  });

  it('forbidden key lists are frozen', () => {
    expect(Object.isFrozen(ALLOWED_CATALOG_KEYS)).toBe(true);
    expect(Object.isFrozen(ALLOWED_PAGE_KEYS)).toBe(true);
  });
});
