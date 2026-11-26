import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { createPdfium } from '../src/engine-worker/pdfium.js';
import { buildEntities } from '../src/model/index.js';
import { itemsToLines, findTableHints, joinFormPairs, linesToParagraphs, buildDocument } from '../src/model/expediente/index.js';
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

  const phoneText = [{ text: 'Teléfono: (57+601) 5439850, (57+601) 5439855' }];
  const cedHints = (...vs) => vs.map((value) => ({ type: 'CEDULA', value }));

  it('un fin de teléfono bajo «Cédula» es alias del teléfono, no una cédula', () => {
    const ents = buildEntities(phoneText, { hints: cedHints('5439850', '5439855') });
    expect(ents.filter((e) => e.type === 'CEDULA')).toEqual([]);
    const tel = ents.filter((e) => e.type === 'TELEFONO');
    expect(tel.length).toBeGreaterThan(0);
    expect(tel.flatMap((e) => e.aliases)).toEqual(expect.arrayContaining(['5439850', '5439855']));
  });

  it('una pista que no está dentro de otro dato sigue siendo cédula', () => {
    const ents = buildEntities(phoneText, { hints: cedHints('1234567') });
    expect(ents.find((e) => e.type === 'CEDULA')).toMatchObject({ value: '1234567' });
  });

  it('una pista que solo coincide en parte de las cifras no se une al teléfono', () => {
    const ents = buildEntities(phoneText, { hints: cedHints('5439') });
    expect(ents.find((e) => e.type === 'CEDULA')).toMatchObject({ value: '5439' });
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

// Formulario de dos columnas: pdf.js entrega primero los valores y después las etiquetas.
const fl = (text, x, y, right, h = 8) => ({ text, x, y, h, right, cells: [{ text, x, right }] });
const formLines = () => [
  fl('Cédula de Ciudadanía', 122, 726.63, 210), fl('1047234567', 122, 716.63, 170), fl('MARTA LUCIA PEREZ GOMEZ', 122, 706.63, 250),
  fl('CALLE 45 # 12-30 ED TORRES DE PINARES', 122, 696.63, 300), fl('Activo', 122, 686.63, 145),
  fl('09/02/1975', 414, 727.63, 460), fl('01/02/2020', 414, 716.63, 460), fl('ana@example.com', 414, 706.63, 490),
  fl('INFORME DE AFILIACIÓN', 200, 760, 400, 12),
  fl('Tipo de Documento:', 31, 726.63, 103), fl('Número de Documento:', 31, 716.63, 115.9), fl('Nombre:', 31, 706.63, 61.7),
  fl('Dirección:', 31, 696.63, 66.6), fl('Estado Afiliación:', 31, 686.63, 92.4),
  fl('Fecha de Nacimiento:', 315, 726.63, 392.8), fl('Fecha de Afiliación:', 315, 716.63, 390), fl('Correo:', 315, 706.63, 345)
];

describe('joinFormPairs: etiqueta y valor al lado', () => {
  it('une cada etiqueta con su valor, sin usar un valor dos veces', () => {
    const out = joinFormPairs(formLines());
    const texts = out.map((l) => l.text);
    expect(texts).toContain('Nombre: MARTA LUCIA PEREZ GOMEZ');
    expect(texts).toContain('Dirección: CALLE 45 # 12-30 ED TORRES DE PINARES');
    expect(texts).toContain('Fecha de Nacimiento: 09/02/1975');
    expect(texts).toContain('Fecha de Afiliación: 01/02/2020');
    expect(texts).toContain('Correo: ana@example.com');
    expect(texts).toContain('Tipo de Documento: Cédula de Ciudadanía');
    expect(texts).toContain('Estado Afiliación: Activo');
    expect(texts).toContain('Número de Documento: 1047234567');
    expect(out.length).toBe(formLines().length - 8);
    expect(texts).toContain('INFORME DE AFILIACIÓN');
    const pair = out.find((l) => l.text === 'Nombre: MARTA LUCIA PEREZ GOMEZ');
    expect(pair).toMatchObject({ x: 31, y: 706.63, right: 250, pair: true });
    expect(pair.cells.map((c) => c.text)).toEqual(['Nombre:', 'MARTA LUCIA PEREZ GOMEZ']);
  });
  it('no cambia la entrada y deja intactas las líneas sin pareja', () => {
    const input = formLines();
    const copy = JSON.stringify(input);
    joinFormPairs(input);
    expect(JSON.stringify(input)).toBe(copy);
    const out = joinFormPairs([fl('Teléfono:', 31, 600, 80), fl('Otra cosa', 31, 500, 100)]);
    expect(out.map((l) => l.text)).toEqual(['Teléfono:', 'Otra cosa']);
    expect(out[0].pair).toBeUndefined();
  });
  it('no une un valor más lejos de 12 veces la altura', () => {
    const out = joinFormPairs([fl('Nombre:', 31, 600, 61.7), fl('LEJOS', 61.7 + 8 * 12 + 1, 600, 300)]);
    expect(out.map((l) => l.text)).toEqual(['Nombre:', 'LEJOS']);
  });
  it('cada pareja es su propio párrafo', () => {
    const lines = [fl('Nombre:', 31, 700, 61.7), fl('ANA', 122, 700, 140), fl('Dirección:', 31, 690, 66), fl('CALLE 1', 122, 690, 170), fl('texto suelto aparte', 31, 680, 140)];
    const paragraphs = linesToParagraphs(joinFormPairs(lines));
    expect(paragraphs).toEqual(['Nombre: ANA', 'Dirección: CALLE 1', 'texto suelto aparte']);
  });
  it('buildDocument aplica la unión a las páginas', () => {
    const doc = buildDocument([{ number: 1, lines: formLines() }]);
    expect(doc.paragraphs.map((p) => p.text)).toContain('Nombre: MARTA LUCIA PEREZ GOMEZ');
  });
});
