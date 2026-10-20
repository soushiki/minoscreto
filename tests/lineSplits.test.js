import { describe, it, expect } from 'vitest';
import { buildEntities, toNeedles, findOccurrences } from '../src/model/index.js';
import { buildDocument, anonymizeTexts } from '../src/model/expediente/index.js';

const para = (texts) => texts.map((text) => ({ text }));
const hidden = (texts, entities) => {
  const needles = toNeedles(entities.filter((e) => e.enabled));
  return texts.map((t) => {
    let out = t;
    for (const o of findOccurrences(t, needles).reverse()) out = out.slice(0, o.start) + '█' + out.slice(o.end);
    return out;
  });
};

describe('datos partidos entre párrafos (líneas de OCR, Word convertido)', () => {
  it('un nombre partido se oculta en los dos párrafos, con una sola etiqueta', () => {
    const texts = ['y por la otra parte RUBIELA ESPERANZA CORTÉS', 'MALAGÓN, identificada con cédula de ciudadanía'];
    const ents = buildEntities(para(texts));
    const people = ents.filter((e) => e.type === 'PERSONA');
    expect(people).toHaveLength(1);
    expect(people[0].value).toBe('RUBIELA ESPERANZA CORTÉS MALAGÓN');
    expect(hidden(texts, ents)).toEqual(['y por la otra parte █', '█, identificada con cédula de ciudadanía']);
  });

  it('un nombre en varias líneas de una palabra', () => {
    const texts = ['el contratista', 'OSVALDO', 'TEÓFILO', 'BARRAGÁN', 'PEÑA,', 'identificado con la cédula'];
    expect(hidden(texts, buildEntities(para(texts)))).toEqual(['el contratista', '█', '█', '█', '█,', 'identificado con la cédula']);
  });

  it('una cédula cuya pista quedó en la línea anterior', () => {
    const texts = ['identificada con cédula de ciudadanía No.', '52.318.904 de Tunja'];
    const ents = buildEntities(para(texts));
    expect(ents.find((e) => e.type === 'CEDULA')).toMatchObject({ value: '52.318.904', enabled: true });
  });

  it('no une párrafos que terminan una frase ni pedazos sueltos', () => {
    const texts = ['Firmado en Tunja el 3 de mayo.', 'GERENCIA GENERAL', 'Lorenzo Antonio Paredes Rincón', 'C.C. 1.010.203.040'];
    const people = buildEntities(para(texts)).filter((e) => e.type === 'PERSONA');
    expect(people.map((e) => e.value)).toEqual(['Lorenzo Antonio Paredes Rincón']);
  });

  it('en el modo expediente (PDF con líneas de OCR sueltas)', () => {
    const lines = ['Que el supervisor designado, el señor', 'HERIBERTO CAMILO SALCEDO', 'URIBE identificado con cédula de ciudadanía No.', '79.456.120', 'remitió el informe.']
      .map((text) => ({ text }));
    const doc = buildDocument([{ number: 1, lines }]);
    const texts = doc.paragraphs.map((p) => p.text);
    const { texts: out } = anonymizeTexts(texts, buildEntities(doc.paragraphs));
    const all = out.join(' ');
    for (const leaked of ['HERIBERTO', 'SALCEDO', 'URIBE', '79.456.120']) expect(all).not.toContain(leaked);
  });
});
