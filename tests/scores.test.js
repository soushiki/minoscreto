import { describe, it, expect } from 'vitest';
import { detect, buildEntities } from '../src/model/index.js';
import { nitCheckDigitOk, THRESHOLD } from '../src/model/scores.js';

describe('dígito de verificación del NIT (DIAN)', () => {
  it.each([['800.197.268-4', true], ['899999068-1', true], ['860034313-7', true], ['800.197.268-5', false], ['899999068-0', false]])(
    '%s → %s', (nit, ok) => expect(nitCheckDigitOk(nit)).toBe(ok)
  );

  it('sin dígito de verificación no se puede validar', () => {
    expect(nitCheckDigitOk('800197268')).toBeNull();
  });
});

describe('puntaje de confianza', () => {
  const nits = (text) => detect(text).filter((d) => d.type === 'NIT');

  it('cada detección trae un puntaje; desde el umbral se activa sola', () => {
    const [d] = detect('identificado con C.C. No. 71.234.567');
    expect(d.score).toBeGreaterThanOrEqual(THRESHOLD);
    expect(d.weak).toBeUndefined();
  });

  it('un NIT sin la palabra «NIT» con dígito de verificación que no cuadra queda como sugerencia', () => {
    expect(nits('la cuenta 800.197.268-5 registra')[0]).toMatchObject({ weak: true });
    expect(nits('la cuenta 800.197.268-4 registra')[0].weak).toBeUndefined();
  });

  it('con la palabra «NIT» se oculta aunque el dígito no cuadre (puede ser un error de digitación)', () => {
    const ents = buildEntities([{ text: 'sociedad con NIT 800.197.268-5' }]);
    expect(ents.find((e) => e.type === 'NIT')).toMatchObject({ value: '800.197.268-5', enabled: true });
  });
});
