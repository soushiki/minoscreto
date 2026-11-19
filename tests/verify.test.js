import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, PDFName, PDFHexString, PDFString, StandardFonts } from 'pdf-lib';
import { scrubPdf } from '../src/model/pdf/scrub.js';
import { verifyProtected, verifyRestored } from '../src/model/layout/verify.js';

// pdf.js real en Node: la versión legacy y su worker falso, como en expediente.test.js.
vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));

const fixture = (name) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, 'fixtures', name)));
const VALUE = 'Laura Patricia Ortega Jiménez';
const entity = (id, label, value, enabled = true, aliases = []) => ({ id, type: label.split('_')[0], value, aliases, label, enabled });
const ENTITIES = [entity('p1', 'PERSONA_1', VALUE), entity('c1', 'CEDULA_1', '73.215.884')];

const utf16Hex = (s) => `FEFF${[...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
const bytesOf = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
const asciiHex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();

// Un PDF de una página con esas líneas; `extra(doc, page)` siembra lo demás. Se limpia como en el flujo real,
// salvo `dirty` (para probar metadatos y claves prohibidas).
async function makePdf(lines, { extra, dirty = false } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 60, y: 780 - i * 14, size: 11, font }));
  if (extra) extra(doc, page);
  const bytes = await doc.save({ useObjectStreams: false });
  return dirty ? bytes : scrubPdf(bytes);
}

// Un XObject de formulario que la página declara pero nunca dibuja: pdf.js no lo muestra, el flujo sí lo lleva.
function unusedForm(doc, page, content, { flate = true } = {}) {
  const dict = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] };
  const stream = flate ? doc.context.flateStream(content, dict) : doc.context.stream(content, dict);
  const ref = doc.context.register(stream);
  page.node.setXObject(PDFName.of('Fx0'), ref);
}

const CLEAN = ['Demandante: [PERSONA_1], identificada con cédula [CEDULA_1].', 'Pretensiones: pago de lo debido.'];

describe('verifyProtected (R2, R4, S7, ADR-006)', () => {
  it('passes a clean file with only tags', async () => {
    expect(await verifyProtected(await makePdf(CLEAN), ENTITIES)).toEqual({ ok: true });
  });

  it('fails on a value left in the page text', async () => {
    const bytes = await makePdf([`Demandante: ${VALUE}, mayor de edad.`]);
    expect(await verifyProtected(bytes, ENTITIES)).toEqual({ ok: false, reason: 'missed-value', where: 'page-text' });
  });

  it('catches casing and accent variants in the page text', async () => {
    for (const variant of ['LAURA PATRICIA ORTEGA JIMENEZ', 'laura patricia ortega jiménez', 'Laura Patricia Ortega Jimenez']) {
      const bytes = await makePdf([`Demandante: ${variant}.`]);
      expect(await verifyProtected(bytes, ENTITIES), variant).toMatchObject({ ok: false, reason: 'missed-value' });
    }
  });

  it('catches a value split across two lines (as detection joins them)', async () => {
    const bytes = await makePdf(['El juzgado admite la demanda presentada por la señora Laura Patricia', 'Ortega Jiménez contra la empresa demandada.']);
    expect(await verifyProtected(bytes, ENTITIES)).toMatchObject({ ok: false, where: 'page-text' });
  });

  it('catches an alias of an active value', async () => {
    const ents = [entity('p1', 'PERSONA_1', VALUE, true, ['la señora Ortega'])];
    const bytes = await makePdf(['Comparece la señora Ortega a la audiencia.']);
    expect(await verifyProtected(bytes, ents)).toMatchObject({ ok: false, reason: 'missed-value' });
  });

  it('ignores a disabled value and a number glued inside a longer one (same rules as detection)', async () => {
    const ents = [entity('p1', 'PERSONA_1', VALUE, false), entity('c1', 'CEDULA_1', '73.215.884')];
    const bytes = await makePdf([`Demandante: ${VALUE}.`, 'Radicado 173.215.8841 del juzgado.']);
    expect(await verifyProtected(bytes, ents)).toEqual({ ok: true });
  });

  it('fails on a value in a raw stream nobody draws (flate, octal escape, other casing)', async () => {
    const bytes = await makePdf(CLEAN, { extra: (doc, page) => unusedForm(doc, page, 'BT /F1 9 Tf (ORTEGA JIM\\311NEZ LAURA PATRICIA) Tj ET\n% laura patricia ortega jiménez') });
    expect(await verifyProtected(bytes, ENTITIES)).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
  });

  it('fails on a value inside an escaped or hex string in a stream', async () => {
    for (const content of ['BT (Laura Patricia Ortega Jim\\351nez) Tj ET', `BT <${asciiHex('Laura Patricia Ortega Jimenez')}> Tj ET`]) {
      const bytes = await makePdf(CLEAN, { extra: (doc, page) => unusedForm(doc, page, content, { flate: false }) });
      expect(await verifyProtected(bytes, ENTITIES), content).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    }
  });

  it('fails on a value split into TJ pieces or Tj words in a stream nobody draws', async () => {
    for (const content of [
      'BT [(Laura Pa)-20(tricia Ortega Jim)5(\\351nez)] TJ ET',
      'BT (Laura) Tj (Patricia) Tj (Ortega) Tj (Jim\\351nez) Tj ET',
      `BT [<${asciiHex('LAURA PATRICIA')}> -15 <${asciiHex(' ORTEGA JIMENEZ')}>] TJ ET`,
    ]) {
      const bytes = await makePdf(CLEAN, { extra: (doc, page) => unusedForm(doc, page, content) });
      expect(await verifyProtected(bytes, ENTITIES), content).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    }
  });

  it('finds a value straddling the 256 kB scan slices of a large stream', async () => {
    for (const at of [256 * 1024 - 10, 700 * 1024]) {
      const content = `${' '.repeat(at)}% ${VALUE}\n${' '.repeat(1024)}`;
      const bytes = await makePdf(CLEAN, { extra: (doc, page) => unusedForm(doc, page, content) });
      expect(await verifyProtected(bytes, ENTITIES), String(at)).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    }
  });

  it('does not rely on scrub: an orphan object or an earlier revision fails', async () => {
    const clean = await makePdf(CLEAN);
    const doc = await PDFDocument.load(clean, { updateMetadata: false });
    doc.context.register(doc.context.obj({ Nota: PDFString.of(`cedula 73.215.884 de ${VALUE}`) }));
    const orphan = await doc.save({ useObjectStreams: false });
    expect(await verifyProtected(orphan, ENTITIES)).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    const appended = new Uint8Array([...clean, ...bytesOf('\n% revisión vieja\nstartxref\n123\n%%EOF\n')]);
    expect(await verifyProtected(appended, ENTITIES)).toEqual({ ok: false, reason: 'error', where: 'revisions' });
    // Un «%%EOF» suelto dentro de un flujo no es una revisión.
    const inStream = await makePdf(CLEAN, { extra: (doc, page) => unusedForm(doc, page, '% texto\n%%EOF\n', { flate: false }) });
    expect(await verifyProtected(inStream, ENTITIES)).toEqual({ ok: true });
  });

  it('finds a hidden value after binary junk with a stray parenthesis', async () => {
    const content = '\x00\xff((( \x01 basura\nBT [(Laura Pa)-20(tricia Ortega Jim)(\\351nez)] TJ ET';
    const bytes = await makePdf(CLEAN, { extra: (doc, page) => unusedForm(doc, page, content) });
    expect(await verifyProtected(bytes, ENTITIES)).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
  });

  it('fails closed when the check itself throws', async () => {
    const broken = [{ ...ENTITIES[0], aliases: 5 }];
    expect(await verifyProtected(await makePdf(CLEAN), broken)).toEqual({ ok: false, reason: 'error', where: 'check-failed' });
  });

  it('fails on a value in a string object (UTF-16BE, lowercase, no accent) and a literal one', async () => {
    const plant = (str) => (doc, page) => {
      const props = doc.context.obj({ P0: doc.context.obj({ Alt: str }) });
      page.node.Resources().set(PDFName.of('Properties'), props);
    };
    for (const str of [PDFHexString.of(utf16Hex('laura patricia ortega jimenez')), PDFString.of('cedula 73.215.884')]) {
      const bytes = await makePdf(CLEAN, { extra: plant(str) });
      expect(await verifyProtected(bytes, ENTITIES)).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    }
  });

  it('fails on a value in metadata, and on any forbidden key even without a value', async () => {
    const withTitle = await makePdf(CLEAN, { dirty: true, extra: (doc) => doc.setTitle(VALUE) });
    expect(await verifyProtected(withTitle, ENTITIES)).toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    const withInfo = await makePdf(CLEAN, { dirty: true, extra: (doc) => doc.setProducer('Otro programa') });
    expect(await verifyProtected(withInfo, ENTITIES)).toEqual({ ok: false, reason: 'error', where: 'forbidden-key' });
  });

  it('passes an image stream, but not one whose raw bytes spell a value (e.g. a JPEG comment); fails on an unknown filter', async () => {
    const image = (filter, data) => (doc, page) => {
      const stream = doc.context.stream(data, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: filter });
      page.node.setXObject(PDFName.of('Im0'), doc.context.register(stream));
    };
    const pixels = 'ÿØÿà datos de imagen ÿÙ';
    expect(await verifyProtected(await makePdf(CLEAN, { extra: image('DCTDecode', pixels) }), ENTITIES)).toEqual({ ok: true });
    expect(await verifyProtected(await makePdf(CLEAN, { extra: image('DCTDecode', `ÿþ Autor: ${VALUE}`) }), ENTITIES))
      .toEqual({ ok: false, reason: 'missed-value', where: 'object' });
    expect(await verifyProtected(await makePdf(CLEAN, { extra: image('RaroDecode', pixels) }), ENTITIES)).toEqual({ ok: false, reason: 'error', where: 'undecoded' });
  });

  it('fails closed on bytes it cannot read (damaged, password)', async () => {
    const damaged = bytesOf('%PDF-1.7\nno es un pdf');
    expect(await verifyProtected(damaged, ENTITIES)).toEqual({ ok: false, reason: 'error', where: 'unreadable' });
    expect(await verifyProtected(fixture('contrasena_usuario_sintetico.pdf'), ENTITIES)).toEqual({ ok: false, reason: 'error', where: 'unreadable' });
  });

  it('fails on the table fixture with its values in the cells and on the dirty fixture; passes it once scrubbed', async () => {
    const values = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'tabla_sintetico.json'), 'utf8'));
    const ents = Object.entries(values).map(([tag, value], i) => entity(`t${i}`, tag.slice(1, -1), value));
    expect(await verifyProtected(fixture('tabla_sintetico.pdf'), ents)).toMatchObject({ ok: false, reason: 'missed-value' });
    // El sucio lleva el valor en Info, XMP, nota, formulario y adjunto: falla; ya limpio, pasa.
    expect(await verifyProtected(fixture('sucio_sintetico.pdf'), ENTITIES)).toMatchObject({ ok: false, reason: 'missed-value', where: 'object' });
    expect(await verifyProtected(await scrubPdf(fixture('sucio_sintetico.pdf')), ENTITIES)).toEqual({ ok: true });
  });

  it('never changes the bytes it checks and never returns the value', async () => {
    const bytes = await makePdf([`Demandante: ${VALUE}.`]);
    const copy = bytes.slice();
    const result = await verifyProtected(bytes, ENTITIES);
    expect(bytes).toEqual(copy);
    expect(JSON.stringify(result)).not.toMatch(/Laura|Ortega/i);
  });

  it('rejects bad arguments', async () => {
    await expect(verifyProtected(new Uint8Array(), ENTITIES)).rejects.toThrow(TypeError);
    await expect(verifyProtected(await makePdf(CLEAN), null)).rejects.toThrow(TypeError);
  });
});

describe('verifyRestored (R7, R8, ADR-006)', () => {
  const DICT = { '[PERSONA_1]': VALUE, '[CEDULA_1]': '73.215.884' };

  it('passes when every known tag got its value back; unknown bracketed text is fine', async () => {
    const bytes = await makePdf([`Demandante: ${VALUE}, cédula 73.215.884.`, 'Ver anexo [OTRO_9] y [nota del juez].']);
    expect(await verifyRestored(bytes, DICT)).toEqual({ ok: true });
  });

  it('fails when a known tag is left', async () => {
    const bytes = await makePdf([`Demandante: ${VALUE}, cédula [CEDULA_1].`]);
    expect(await verifyRestored(bytes, DICT)).toEqual({ ok: false, reason: 'missed-value', where: 'page-text' });
  });

  it('fails on tags cut across lines (rejoinTags forms)', async () => {
    const { keys } = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'etiquetas_fin_de_linea_sintetico.json'), 'utf8'));
    const dict = Object.fromEntries(keys.map((k) => [k, 'valor']));
    expect(await verifyRestored(fixture('etiquetas_fin_de_linea_sintetico.pdf'), dict)).toMatchObject({ ok: false, reason: 'missed-value' });
    const bytes = await makePdf(['La parte demandante, [PERSO-', 'NA_1], solicita el pago.']);
    expect(await verifyRestored(bytes, DICT)).toMatchObject({ ok: false, reason: 'missed-value' });
  });

  it('fails closed on unreadable bytes and rejects a bad dictionary', async () => {
    expect(await verifyRestored(bytesOf('%PDF-1.7\nroto'), DICT)).toEqual({ ok: false, reason: 'error', where: 'unreadable' });
    await expect(verifyRestored(await makePdf(CLEAN), [])).rejects.toThrow(TypeError);
    expect(await verifyRestored(await makePdf([VALUE]), { '': 'x', ...DICT })).toEqual({ ok: true });
  });
});

describe('ADR-006 fitness: one matcher', () => {
  it('verify.js uses the anonymizer’s own matcher', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/model/layout/verify.js'), 'utf8');
    expect(src, 'ADR-006: layout bytes must pass verify').toMatch(/import \{ anonymizeTexts \} from '\.\.\/expediente\/anonymize\.js'/);
    expect(src).not.toMatch(/findOccurrences|toLowerCase|normalize\(/);
  });
});
