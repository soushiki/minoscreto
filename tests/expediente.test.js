import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildEntities, buildDictionary } from '../src/model/index.js';
import {
  itemsToLines, linesToParagraphs, isHeading, reducePages, isJunk, isPageNumber, buildDocument, formatPageRanges,
  splitParts, renderParts, renderWhole, renderBlocks, buildPartsZip, anonymizeTexts, buildSearchIndex, searchIndex,
  findOcrVariants, acceptOcrVariant, tidyEntities, fixDigitConfusions, PART_HEADER_TOKENS
} from '../src/model/expediente/index.js';

const item = (str, x, y, { w = str.length * 5, h = 10, eol = false } = {}) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, hasEOL: eol });
const line = (text, y, { x = 72, right = 520 } = {}) => ({ text, x, y, h: 10, right });

describe('reconstrucción de párrafos', () => {
  it('agrupa fragmentos de pdf.js en líneas, con espacios entre palabras separadas', () => {
    const lines = itemsToLines([
      item('El', 72, 700, { w: 10 }), item('señor', 86, 700, { w: 26 }), item('Pérez', 116, 700.4, { w: 26, eol: true }),
      item('', 0, 0), item('firmó.', 72, 687, { w: 30 })
    ]);
    expect(lines.map((l) => l.text)).toEqual(['El señor Pérez', 'firmó.']);
    expect(lines[0]).toMatchObject({ x: 72, y: 700, right: 142 });
  });

  it('une líneas, quita el guion de fin de línea y corta en líneas cortas con punto', () => {
    const paragraphs = linesToParagraphs([
      line('El despacho advierte que se cumplen los presu-', 700),
      line('puestos procesales de competencia y capacidad para', 687.5),
      line('ser parte.', 675, { right: 140 }),
      line('Mediante auto se ordenó el traslado.', 662.5, { x: 90 })
    ]);
    expect(paragraphs).toEqual([
      'El despacho advierte que se cumplen los presupuestos procesales de competencia y capacidad para ser parte.',
      'Mediante auto se ordenó el traslado.'
    ]);
  });

  it('corta en saltos verticales grandes, títulos y viñetas, y conserva guiones de palabras compuestas', () => {
    const paragraphs = linesToParagraphs([
      line('CONSIDERANDOS', 720, { right: 160 }),
      line('Primera línea del texto que sigue sin punto y', 700),
      line('termina aquí con un acuerdo franco-', 687.5),
      line('Colombiano firmado.', 675, { right: 200 }),
      line('Bloque lejano que empieza tras un espacio grande.', 640),
      line('a) primera viñeta', 627.5, { right: 200 }),
      line('b) segunda viñeta', 615, { right: 200 })
    ]);
    expect(paragraphs).toEqual([
      'CONSIDERANDOS',
      'Primera línea del texto que sigue sin punto y termina aquí con un acuerdo franco- Colombiano firmado.',
      'Bloque lejano que empieza tras un espacio grande.',
      'a) primera viñeta',
      'b) segunda viñeta'
    ]);
  });

  it('funciona con líneas sin posición (solo texto y líneas en blanco)', () => {
    expect(linesToParagraphs(['Primera parte del pá-', 'rrafo continúa', '', 'Otro párrafo.'])).toEqual(['Primera parte del párrafo continúa', 'Otro párrafo.']);
  });

  it('reconoce títulos de sección y no confunde frases que empiezan igual', () => {
    for (const t of ['CAPÍTULO III', 'Cláusula Primera', 'CONSIDERANDOS', 'RESUELVE:', 'Resuelve', '2.1 Hechos probados', 'III. CONSIDERACIONES DEL DESPACHO', '1. ANTECEDENTES']) {
      expect(isHeading(t), t).toBe(true);
    }
    for (const t of ['Considerando que el demandante no probó', '1. El demandante presentó la demanda el día señalado.', 'artículo 5 del código', 'Resuelve el despacho que, en atención a lo anterior, se niega.']) {
      expect(isHeading(t), t).toBe(false);
    }
  });
});

const WORDS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];
const HEADER = ['JUZGADO TERCERO CIVIL DEL CIRCUITO', 'Radicado 2023-00123'];
const page = (number, body, { header = true, footer = true, total = 6 } = {}) => ({
  number,
  lines: [
    ...(header ? HEADER : []),
    ...body,
    ...[1, 2, 3, 4].map((k) => `Renglón ${k} del cuerpo del folio ${WORDS[number]}.`),
    ...(footer ? [`Página ${number} de ${total}`] : [])
  ].map((text) => ({ text }))
});
const texts = (p) => p.lines.map((l) => l.text);

describe('reducción de tamaño', () => {
  it('quita encabezados y pies repetidos, números de página y basura del OCR', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => page(n, [`Texto propio del folio ${WORDS[n]}.`, n === 3 ? "' . , ~ ¦" : 'Otra línea.']));
    const { pages: out, removed } = reducePages(pages);
    expect(texts(out[0]).slice(0, 2)).toEqual(['Texto propio del folio uno.', 'Otra línea.']);
    expect(texts(out[2]).slice(0, 2)).toEqual(['Texto propio del folio tres.', 'Renglón 1 del cuerpo del folio tres.']);
    expect(texts(out[0]).at(-1)).toBe('Renglón 4 del cuerpo del folio uno.');
    expect(out[0].top.map((l) => l.text)).toEqual(HEADER);
    expect(out[0].bottom.map((l) => l.text)).toEqual(['Página 1 de 6']);
    expect(removed).toMatchObject({ repeated: 15, junk: 1 });
  });

  it('no toca encabezados que aparecen en pocas páginas y no confunde texto con basura', () => {
    const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => page(n, [`Folio ${WORDS[n]} texto.`], { header: n === 1 }));
    const { pages: out } = reducePages(pages);
    expect(texts(out[0])).toContain('JUZGADO TERCERO CIVIL DEL CIRCUITO');
    expect(texts(out[4])).not.toContain('Página 5 de 6');
    for (const t of ['1.', 'a)', 'Y', 'RESUELVE:', 'C.C. 45.521.884']) expect(isJunk(t), t).toBe(false);
    for (const t of ['|||  ..  ,', '~ ¦ .', 'i l ! ; ·', '———']) expect(isJunk(t), t).toBe(true);
    for (const t of ['12', '- 12 -', 'Página 3 de 600', 'Folio 45', 'pág. 7']) expect(isPageNumber(t), t).toBe(true);
    expect(isPageNumber('12 de marzo')).toBe(false);
  });

  it('marca folios sin texto y reduce el tamaño estimado', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => page(n, [`Contenido del folio número ${WORDS[n]} con texto suficiente.`]));
    pages.push({ number: 6, lines: [{ text: '·' }] });
    const full = buildDocument(pages);
    const reduced = buildDocument(pages, { reduce: true });
    expect(full.emptyPages).toEqual([6]);
    expect(reduced.tokens).toBeLessThan(full.tokens);
    expect([...new Set(reduced.paragraphs.map((p) => p.page))]).toEqual([1, 2, 3, 4, 5]);
    expect(reduced.paragraphs.some((p) => /JUZGADO|Página/.test(p.text))).toBe(false);
    expect(formatPageRanges([9, 3, 4, 5, 12, 13])).toBe('3–5, 9, 12–13');
  });

  it('une el párrafo que cruza de folio para no partir un nombre, también sin reducir', () => {
    const raw = (number, body) => ({ number, lines: [...HEADER, ...body, `Página ${number} de 4`].map((text) => ({ text })) });
    const pages = [
      raw(1, ['Primer renglón del cuerpo uno.', '', 'Segundo bloque del folio uno.', '', 'La apoderada María Fernanda']),
      raw(2, ['Quintero Salas allegó el memorial.', '', 'Segundo párrafo del folio dos.', '', 'Cierre dos.']),
      raw(3, ['Texto tres a.', '', 'Texto tres b.', '', 'Texto tres c.']),
      raw(4, ['Texto cuatro a.', '', 'Texto cuatro b.', '', 'Texto cuatro c.'])
    ];
    const reduced = buildDocument(pages, { reduce: true });
    expect(reduced.paragraphs[2]).toMatchObject({ text: 'La apoderada María Fernanda Quintero Salas allegó el memorial.', page: 1, endPage: 2 });
    expect(reduced.pageJoins).toBe(1);
    const full = buildDocument(pages);
    expect(full.paragraphs.map((p) => p.text).slice(0, 8)).toEqual([
      ...HEADER, 'Primer renglón del cuerpo uno.', 'Segundo bloque del folio uno.',
      'La apoderada María Fernanda Quintero Salas allegó el memorial.', 'Página 1 de 4', ...HEADER
    ]);
    expect(full.paragraphs[8]).toMatchObject({ text: 'Segundo párrafo del folio dos.', page: 2 });
  });
});

describe('errores de OCR', () => {
  it('corrige 0 y 1 dentro de palabras sin tocar números, placas, correos ni referencias', () => {
    expect(fixDigitConfusions('J0rge Mora1es y 0scar Restrep0 firmaron.').text).toBe('Jorge Morales y Oscar Restrepo firmaron.');
    const keep = 'Placa ABC123, Carrera 43A No. 1-50, NIT 900.765.432-0, juan01@correo.com, rad. 2023-00123, 1er piso, RAD01.';
    expect(fixDigitConfusions(keep)).toEqual({ text: keep, fixes: 0 });
  });

  it('sugiere unir variantes mal escritas por el OCR y no mezcla personas distintas', () => {
    const texts = [
      'La señora Laura Patricia Ortega Jiménez firmó. Laura Patricia Ortega Jiménez declaró. También Laura Patricia Ortega Jiménez.',
      'Luego compareció Laura Patrlcia Ortega Jiménez.', 'Después firmó Laura Patricia Ortega Jirnénez.',
      'Claudia Patricia Morales Díaz es otra persona; Claudia Patricia Morales Díaz también firmó.'
    ];
    let entities = buildEntities(texts.map((text) => ({ text })));
    const laura = entities.find((e) => e.value === 'Laura Patricia Ortega Jiménez');
    const found = findOcrVariants(texts, entities);
    expect(found.every((s) => s.entityId === laura.id)).toBe(true);
    expect(found.map((s) => s.variant).sort()).toEqual(['Laura Patricia Ortega Jirnénez', 'Laura Patrlcia Ortega Jiménez']);
    for (const s of found) entities = acceptOcrVariant(entities, s);
    const out = anonymizeTexts(texts, entities).texts.join(' ');
    expect(out).not.toMatch(/Laura|Ortega/);
    expect(new Set(out.match(/\[PERSONA_\d+\]/g)).size).toBe(2);
  });

  it('apaga pedazos de nombre demasiado cortos que deja el OCR', () => {
    const entities = tidyEntities([{ id: 'a', type: 'PERSONA', value: 'J', aliases: [], label: 'PERSONA_1', enabled: true, manual: false }]);
    expect(entities[0].enabled).toBe(false);
  });
});

const blocksOf = (spec) => spec.map(([page, chars, heading = false], index) => ({ index, page, text: 'x'.repeat(chars), heading }));

describe('división en partes', () => {
  it('por folios: cada parte tiene N folios y ningún párrafo se corta', () => {
    const blocks = blocksOf([[1, 100], [1, 100], [2, 100], [3, 100], [3, 100], [4, 100], [5, 100]]);
    const parts = splitParts(blocks, { mode: 'pages', pagesPerPart: 2 });
    expect(parts.map((p) => [p.from, p.to])).toEqual([[0, 3], [3, 6], [6, 7]]);
  });

  it('por tokens: respeta el tope sumando encabezado y solapamiento', () => {
    const blocks = blocksOf(Array.from({ length: 40 }, (_, i) => [i + 1, 4000]));
    const max = 6000;
    const parts = splitParts(blocks, { mode: 'tokens', maxTokens: max, overlap: 1 });
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) expect(p.tokens).toBeLessThanOrEqual(max);
    expect(parts[1].overlapFrom).toBe(parts[1].from - 1);
    expect(parts[parts.length - 1].to).toBe(40);
    parts.slice(1).forEach((p, k) => expect(p.from).toBe(parts[k].to));
  });

  it('por secciones: corta solo en títulos mientras quepa, y parte una sección que no cabe', () => {
    const blocks = blocksOf([
      [1, 40, true], [1, 4000], [2, 4000], [3, 40, true], [3, 4000], [4, 40, true], [4, 4000], [5, 4000], [6, 4000], [7, 4000], [8, 4000], [9, 4000]
    ]);
    const parts = splitParts(blocks, { mode: 'sections', maxTokens: 2200 + PART_HEADER_TOKENS + 50 });
    expect(parts[0]).toMatchObject({ from: 0, to: 3 });
    expect(parts[1]).toMatchObject({ from: 3, to: 5 });
    expect(parts[2].from).toBe(5);
    expect(parts[parts.length - 1].to).toBe(blocks.length);
    expect(splitParts(blocks, { mode: 'sections', maxTokens: 100000 })).toHaveLength(1);
  });

  it('escribe cada parte con «Parte X de N», folios, instrucción y las mismas etiquetas', async () => {
    const texts = ['El señor Carlos Andrés Mendoza Ríos demandó.', 'Carlos Andrés Mendoza Ríos insistió.', 'Fin del caso para Carlos Andrés Mendoza Ríos.'];
    const entities = buildEntities(texts.map((text) => ({ text })));
    const applied = anonymizeTexts(texts, entities);
    const blocks = applied.texts.map((text, index) => ({ index, page: index * 10 + 1, text, heading: false }));
    const parts = splitParts(blocks, { mode: 'pages', pagesPerPart: 1, overlap: 1 });
    const rendered = renderParts({ blocks, parts, emptyPages: [5] });
    expect(rendered).toHaveLength(3);
    expect(rendered[1].text).toMatch(/^Parte 2 de 3 · folio 11\n/);
    expect(rendered[0].text).toContain('responde solo «Recibida la parte 1 de 3» y espera');
    expect(rendered[2].text).toContain('Esta es la última parte (3 de 3)');
    expect(rendered[1].text).toContain('El primer párrafo repite el final de la parte anterior');
    expect(rendered[0].text).toContain('[Folio 1]');
    expect(rendered.every((p) => p.text.includes('[PERSONA_1]') && !p.text.includes('Mendoza'))).toBe(true);
    const dictionary = buildDictionary(entities, new Set(applied.usedIds));
    const zip = await JSZip.loadAsync(await buildPartsZip({ name: 'caso', parts: rendered, dictionary, type: 'uint8array' }));
    expect(Object.keys(zip.files).filter((f) => !f.endsWith('/')).sort()).toEqual([
      'LEEME.txt', 'NO-SUBIR/diccionario.json', 'NO-SUBIR/diccionario.txt',
      'para-subir-a-la-IA/caso-parte-1-de-3.md', 'para-subir-a-la-IA/caso-parte-2-de-3.md', 'para-subir-a-la-IA/caso-parte-3-de-3.md'
    ]);
    expect(JSON.parse(await zip.file('NO-SUBIR/diccionario.json').async('string'))).toEqual({ '[PERSONA_1]': 'Carlos Andrés Mendoza Ríos' });
  });

  it('marca folios sin texto y saltos de una selección', () => {
    const blocks = [{ index: 0, page: 1, text: 'A' }, { index: 1, page: 1, text: 'B' }, { index: 5, page: 4, text: 'C' }, { index: 6, page: 4, text: 'D' }];
    expect(renderBlocks(blocks, [2, 3])).toBe('[Folio 1]\n\nA\n\nB\n\n[…]\n\n[Folios sin texto legible: 2–3]\n\n[Folio 4]\n\nC\n\nD\n');
    expect(renderWhole({ name: 'caso', blocks, emptyPages: [], selection: true })).toMatch(/^# caso \(anonimizado\)\n\nPasajes seleccionados del expediente · folios 1–4/);
  });
});

describe('búsqueda en el expediente', () => {
  it('encuentra sin tildes ni mayúsculas y cuenta todas las coincidencias', () => {
    const index = buildSearchIndex(['El PÉREZ firmó', 'nada', 'Pérez y perez']);
    const r = searchIndex(index, 'perez', 2);
    expect(r.total).toBe(3);
    expect(r.hits).toEqual([{ pi: 0, start: 3, end: 8 }, { pi: 2, start: 0, end: 5 }]);
    expect([...r.paragraphs]).toEqual([0, 2]);
  });
});
