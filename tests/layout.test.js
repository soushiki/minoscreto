import { describe, it, expect } from 'vitest';
import { buildEntities } from '../src/model/index.js';
import { itemsToLines, findTableHints } from '../src/model/expediente/index.js';

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
