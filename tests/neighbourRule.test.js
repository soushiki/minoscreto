import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { detect } from '../src/model/detect.js';
import { buildNameContext } from '../src/model/properNouns.js';
import { setCommonNouns, parseCommonNouns } from '../src/model/lexicon.js';

const list = () => parseCommonNouns(fs.readFileSync('src/model/data/common-nouns.txt', 'utf8'));
const run = (text) => detect(text, buildNameContext([text])).map((e) => ({ ...e, value: text.slice(e.start, e.end) }));
const names = (text) => run(text).filter((e) => e.type === 'NOMBRE' || e.type === 'PERSONA');
const covers = (text, word) => run(text).some((e) => e.value.includes(word));

describe('regla del vecino (lista de comunes cargada)', () => {
  beforeAll(() => setCommonNouns(list()));
  afterAll(() => setCommonNouns([]));

  it('Último Salario no es nombre', () => expect(names('El Último Salario devengado fue de dos millones.')).toEqual([]));
  it('Último Recibo no es nombre', () => expect(names('El Último Recibo llegó tarde.')).toEqual([]));
  it('Pago Decreto no es nombre', () => expect(names('Según el Pago Decreto del mes, la empresa pagó.')).toEqual([]));
  it('Paz y Salvo no es nombre', () => expect(names('Expidió la Paz y Salvo correspondiente.')).toEqual([]));
  it('Novedad Electrónica no es nombre', () => expect(names('Novedad: Nov- POST Electrónica de Tiempos Públicos')).toEqual([]));
  it('Ana Rosa Torres es persona y no cubre Firmó', () => {
    const t = 'Firmó Ana Rosa Torres el contrato.';
    expect(run(t).some((e) => e.type === 'PERSONA' && e.value === 'Ana Rosa Torres')).toBe(true);
    expect(run(t).some((e) => e.value.includes('Firmó'))).toBe(false);
  });
  it('Finca La Esperanza', () => {
    expect(run('El inmueble se llama Finca La Esperanza.').some((e) => e.type === 'NOMBRE' && e.value.includes('La Esperanza'))).toBe(true);
  });
  it('etiqueta Nombre: Victoria Salvo', () => expect(covers('Nombre: Victoria Salvo', 'Victoria Salvo')).toBe(true));
  it('Victoria Paz a mitad de frase', () => expect(covers('La reunión con Victoria Paz fue ayer.', 'Victoria Paz')).toBe(true));
  it('KATIA ESTHER CLARO JAIME', () => {
    expect(run('KATIA ESTHER CLARO JAIME, identificada con C.C. 123').some((e) => e.type === 'PERSONA' && e.value === 'KATIA ESTHER CLARO JAIME')).toBe(true);
  });
  it('Hotel Marasú', () => expect(covers('Nos alojamos en el Hotel Marasú del centro.', 'Marasú')).toBe(true));
});

describe('lista vacía: comportamiento anterior', () => {
  beforeAll(() => setCommonNouns([]));
  afterAll(() => setCommonNouns(list()));
  it('Último Recibo sigue marcado', () => {
    expect(covers('El Último Recibo llegó tarde.', 'Recibo')).toBe(true);
  });
});
