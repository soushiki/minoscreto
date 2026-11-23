import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { createPdfium } from '../src/engine-worker/pdfium.js';
import { buildEntities } from '../src/model/index.js';
import { itemsToLines, findTableHints } from '../src/model/expediente/index.js';
import { classifyPage, SCAN_RULES } from '../src/model/layout/scan.js';

const fixtures = resolve(__dirname, 'fixtures');

// Fragmentos como los de pdf.js: texto, posición (transform[4], transform[5]), ancho y alto 10.
const item = (str, x, y, w = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10, hasEOL: false });
const row = (y, ...cells) => cells.map(([str, x]) => item(str, x, y));
const page = (items) => ({ number: 1, lines: itemsToLines(items) });

describe('tablas: el encabezado de la columna da el tipo', () => {
  const items = [
    ...row(700, ['Nombre', 50], ['Identificación', 250], ['Teléfono', 400], ['Valor', 500]),
    ...row(685, ['PATRICIA NOVOA', 50], ['52318904', 250], ['3104567890', 400], ['$ 1.200.000', 500]),
    ...row(670, ['RUBÉN DARÍO SALAS', 50], ['1.020.304.050', 250], ['6017654321', 400], ['$ 980.000', 500])
  ];

  it('toma los números de las columnas «Identificación» y «Teléfono», no los valores', () => {
    const hints = findTableHints([page(items)]).map((h) => `${h.type}:${h.value}`);
    expect(hints).toEqual(['CEDULA:52318904', 'CEDULA:1.020.304.050', 'TELEFONO:3104567890', 'TELEFONO:6017654321']);
  });

  it('una celda con cifras no es un encabezado', () => {
    const form = [...row(700, ['C.C.71.234.567', 50]), ...row(685, ['Valor $ 101.156.441', 50])];
    expect(findTableHints([page(form)])).toEqual([]);
  });

  it('en una columna «NIT» descarta números cuyo dígito de verificación no cuadra', () => {
    const nits = [...row(700, ['NIT', 50]), ...row(685, ['800.197.268-4', 50]), ...row(670, ['800.197.268-5', 50])];
    expect(findTableHints([page(nits)]).map((h) => h.value)).toEqual(['800.197.268-4']);
  });

  it('buildEntities oculta los números sin pista que llegan como pistas de tabla', () => {
    const ents = buildEntities([{ text: '52318904 PATRICIA NOVOA' }], { hints: [{ type: 'CEDULA', value: '52318904' }] });
    expect(ents.find((e) => e.type === 'CEDULA')).toMatchObject({ value: '52318904', enabled: true });
  });
});

describe('bloques de firma', () => {
  const persons = (texts) => buildEntities(texts.map((text) => ({ text }))).filter((e) => e.type === 'PERSONA' && e.enabled).map((e) => e.value);

  it('un nombre sin nombre de pila conocido, entre la raya y la cédula', () => {
    expect(persons(['_______________________', 'YAMILE OSPITIA BORJA', 'C.C. 52.318.904'])).toContain('YAMILE OSPITIA BORJA');
    expect(persons(['Atentamente,', 'Ludivia Carvajalino Mendoza', 'Contratista'])).toContain('Ludivia Carvajalino Mendoza');
  });

  it('el usuario de una firma digital', () => {
    expect(persons(['TEODOLINDO_PERALTA', 'Firmado Digitalmente por:'])).toContain('TEODOLINDO_PERALTA');
  });

  it('no toma títulos ni cargos', () => {
    expect(persons(['_______________________', 'SECRETARIA DE HACIENDA MUNICIPAL', 'C.C. 52.318.904'])).toEqual([]);
    expect(persons(['Firma', 'Representante Legal'])).toEqual([]);
  });
});

describe('revisión de escaneos por página (R5, T6)', () => {
  const stats = (s) => ({ visibleChars: 0, invisibleChars: 0, imageCoverage: 0, hasImages: false, ...s });

  it('página de texto: texto visible y sin imagen', () => {
    expect(classifyPage(stats({ visibleChars: 2595 }))).toBe('text');
  });

  it('escaneo: imagen de página completa y solo texto invisible (capa OCR)', () => {
    expect(classifyPage(stats({ invisibleChars: 1800, imageCoverage: 0.98, hasImages: true }))).toBe('scan');
  });

  it('escaneo sin OCR: imagen de página completa y nada de texto', () => {
    expect(classifyPage(stats({ imageCoverage: 1, hasImages: true }))).toBe('scan');
  });

  it('membrete: imagen de página completa con texto visible real sigue siendo texto', () => {
    expect(classifyPage(stats({ visibleChars: 1200, imageCoverage: 1, hasImages: true }))).toBe('text');
  });

  it('pocos caracteres visibles sobre imagen completa no bastan para ser texto', () => {
    const limit = SCAN_RULES.minVisibleChars;
    expect(classifyPage(stats({ visibleChars: limit - 1, imageCoverage: 0.95, hasImages: true }))).toBe('scan');
    expect(classifyPage(stats({ visibleChars: limit, imageCoverage: 0.95, hasImages: true }))).toBe('text');
  });

  it('sello visible sobre una capa OCR más grande sigue siendo escaneo (T12)', () => {
    expect(classifyPage(stats({ visibleChars: 43, invisibleChars: 283, imageCoverage: 1, hasImages: true }))).toBe('scan');
    expect(classifyPage(stats({ visibleChars: 283, invisibleChars: 283, imageCoverage: 1, hasImages: true }))).toBe('scan');
    // Texto visible mayor que la capa OCR: texto real (p. ej. plantilla con algo oculto).
    expect(classifyPage(stats({ visibleChars: 284, invisibleChars: 283, imageCoverage: 1, hasImages: true }))).toBe('text');
    // Sin imagen de página, la capa invisible no decide nada.
    expect(classifyPage(stats({ visibleChars: 40, invisibleChars: 500, imageCoverage: 0.5, hasImages: true }))).toBe('text');
  });

  it('imagen que no cubre la página (firma, sello) no hace escaneo', () => {
    const below = SCAN_RULES.minImageCoverage - 0.01;
    expect(classifyPage(stats({ visibleChars: 5, imageCoverage: below, hasImages: true }))).toBe('text');
    expect(classifyPage(stats({ imageCoverage: SCAN_RULES.minImageCoverage, hasImages: true }))).toBe('scan');
  });

  it('página en blanco o con solo un número de página es texto', () => {
    expect(classifyPage(stats({}))).toBe('text');
    expect(classifyPage(stats({ visibleChars: 2 }))).toBe('text');
  });

  it('los umbrales están en un solo objeto congelado', () => {
    expect(SCAN_RULES).toEqual({ minVisibleChars: 30, minImageCoverage: 0.9, ocrOutweighs: true });
    expect(Object.isFrozen(SCAN_RULES)).toBe(true);
  });

  it('datos del motor inválidos fallan en vez de adivinar', () => {
    expect(() => classifyPage(null)).toThrow(TypeError);
    expect(() => classifyPage(stats({ visibleChars: -1 }))).toThrow(TypeError);
    expect(() => classifyPage(stats({ imageCoverage: Number.NaN }))).toThrow(TypeError);
    expect(() => classifyPage(stats({ visibleChars: '40' }))).toThrow(TypeError);
  });
});

// Calibración T12: los umbrales contra páginas reales medidas por PDFium (no números inventados).
describe('calibración de SCAN_RULES con PDFium (T12)', () => {
  let pdfium;
  beforeAll(async () => {
    pdfium = createPdfium(await createPdfRuntime({ prefer: 'wasm' }));
  });
  afterEach(() => pdfium.close());

  const measure = (name) => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, name)));
    const { pageCount } = pdfium.open(bytes);
    return Array.from({ length: pageCount }, (_, i) => pdfium.pageStats(i));
  };

  it.each([
    ['escaneo_sin_ocr_sintetico.pdf', 'scan'],
    ['escaneo_ocr_tesseract_sintetico.pdf', 'scan'],
    ['escaneo_ocrmypdf_estilo_sintetico.pdf', 'scan'],
    ['escaneo_ocr_sello_sintetico.pdf', 'scan'],
    ['membrete_sintetico.pdf', 'text'],
    ['tabla_sintetico.pdf', 'text'],
    ['prosa_sintetico.pdf', 'text']
  ])('%s → %s', (name, expected) => {
    const pages = measure(name);
    for (const stats of pages) expect(classifyPage(stats)).toBe(expected);
  });
});
