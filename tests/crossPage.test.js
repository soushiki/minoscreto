// Valores partidos por un salto de folio (T12c): buildDocument anota dónde se unen los folios (`joins`) y
// crossPagePieces reparte el valor: trozo con etiqueta en el folio anterior, trozo sin etiqueta en el siguiente.
import { describe, it, expect } from 'vitest';
import { buildDocument } from '../src/model/expediente/document.js';
import { crossPagePieces } from '../src/model/layout/crossPage.js';

const page = (number, ...lines) => ({ number, lines: lines.map((text) => ({ text })) });
const LEAD = 'Se demanda en este proceso al señor';
// Un folio con solo «María» cuenta como vacío si no tiene más texto: el encabezado repetido (que se separa) lo evita.
const HEAD = 'Juzgado de prueba expediente sintético';
const needles = (...values) => values.map((value, i) => ({ value, put: `[PERSONA_${i + 1}]` }));

describe('buildDocument: joins', () => {
  it('records where the next page starts inside the joined paragraph', () => {
    const doc = buildDocument([page(1, LEAD + ' Carlos'), page(2, 'Andrés Mendoza Ríos presentó la demanda.')], { fixOcr: false });
    expect(doc.paragraphs).toHaveLength(1);
    const [p] = doc.paragraphs;
    expect(p.joins).toEqual([{ at: (LEAD + ' Carlos ').length, page: 2 }]);
    expect(p.text.slice(p.joins[0].at)).toBe('Andrés Mendoza Ríos presentó la demanda.');
  });

  it('a paragraph without a join has no joins', () => {
    const doc = buildDocument([page(1, 'Uno.'), page(2, 'Dos.')], { fixOcr: false });
    expect(doc.paragraphs.every((p) => !('joins' in p))).toBe(true);
  });
});

describe('crossPagePieces', () => {
  const split = (a, b) => buildDocument([page(1, a), page(2, b)], { fixOcr: false }).paragraphs;

  it('the earlier piece gets the tag on page 0, the later piece none on page 1', () => {
    const pieces = crossPagePieces(split(LEAD + ' Carlos', 'Andrés Mendoza Ríos presentó la demanda.'), needles('Carlos Andrés Mendoza Ríos'));
    expect([...pieces]).toEqual([
      [0, [{ value: 'Carlos', put: '[PERSONA_1]', edge: 'end', context: 'n este proceso al señor' }]],
      [1, [{ value: 'Andrés Mendoza Ríos', put: '', edge: 'start', context: 'presentó la demanda.' }]]
    ]);
  });

  it('a soft-hyphen join (Mendo- + za Ríos) splits at the join', () => {
    const pieces = crossPagePieces(split(LEAD + ' Mendo-', 'za Ríos presentó la demanda.'), needles('Mendoza Ríos'));
    expect(pieces.get(0)).toEqual([{ value: 'Mendo', put: '[PERSONA_1]', edge: 'end', context: 'n este proceso al señor' }]);
    expect(pieces.get(1)).toEqual([{ value: 'za Ríos', put: '', edge: 'start', context: 'presentó la demanda.' }]);
  });

  it('a value crossing two joins is skipped (the final check refuses it)', () => {
    const paragraphs = buildDocument([page(1, HEAD, LEAD + ' Ana'), page(2, HEAD, 'María'), page(3, HEAD, 'Pérez Gómez presentó')], { fixOcr: false }).paragraphs;
    expect(paragraphs.find((p) => p.joins).joins).toHaveLength(2);
    expect(crossPagePieces(paragraphs, needles('Ana María Pérez Gómez')).size).toBe(0);
  });

  it('a value that does not cross a join is ignored', () => {
    const paragraphs = split(LEAD + ' Carlos Pérez', 'presentó la demanda.');
    expect(crossPagePieces(paragraphs, needles('Carlos Pérez')).size).toBe(0);
  });

  it('an empty piece is skipped', () => {
    // El valor termina justo donde empieza el folio: no cruza.
    expect(crossPagePieces(split(LEAD + ' Carlos', 'Andrés presentó'), needles('Carlos')).size).toBe(0);
  });

  it('identical pieces on the same page are not repeated', () => {
    const paragraphs = split(LEAD + ' Carlos', 'Andrés Mendoza Ríos presentó.');
    const pieces = crossPagePieces(paragraphs, [...needles('Carlos Andrés Mendoza Ríos'), ...needles('Carlos Andrés Mendoza Ríos')]);
    expect(pieces.get(0)).toHaveLength(1);
    expect(pieces.get(1)).toHaveLength(1);
  });

  it('context stops at the join: a middle page never leaks into the head or tail context', () => {
    const paragraphs = buildDocument([
      page(1, HEAD, LEAD + ' Ana'),
      page(2, HEAD, 'María y Pedro firmaron Pérez'),
      page(3, HEAD, 'Gómez presentó la demanda')
    ], { fixOcr: false }).paragraphs;
    const first = crossPagePieces(paragraphs, needles('Ana María'));
    expect(first.get(0)).toEqual([{ value: 'Ana', put: '[PERSONA_1]', edge: 'end', context: 'n este proceso al señor' }]);
    expect(first.get(1)).toEqual([{ value: 'María', put: '', edge: 'start', context: 'y Pedro firmaron Pérez' }]);
    const second = crossPagePieces(paragraphs, needles('Pérez Gómez'));
    expect(second.get(1)).toEqual([{ value: 'Pérez', put: '[PERSONA_1]', edge: 'end', context: 'María y Pedro firmaron' }]);
    expect(second.get(2)).toEqual([{ value: 'Gómez', put: '', edge: 'start', context: 'presentó la demanda' }]);
  });

  it('the context is empty when the piece touches the paragraph end', () => {
    const pieces = crossPagePieces(split(LEAD + ' Carlos', 'Andrés Mendoza Ríos presentó'), needles('Carlos Andrés Mendoza Ríos presentó'));
    expect(pieces.get(1)).toEqual([{ value: 'Andrés Mendoza Ríos presentó', put: '', edge: 'start', context: '' }]);
  });
});
