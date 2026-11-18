import { describe, it, expect } from 'vitest';
import { toWinAnsi } from '../src/model/pdf/winAnsi.js';

describe('toWinAnsi (C3, S5)', () => {
  it('keeps every Spanish letter and sign unchanged', () => {
    const spanish = 'áéíóúÁÉÍÓÚüÜñÑ ¿Qué? ¡Sí! 1º 2ª «cita» € — – … ½';
    expect(toWinAnsi(spanish)).toEqual({ text: spanish, replaced: [], dropped: [] });
  });

  it('composes decomposed accents before checking them', () => {
    expect(toWinAnsi('Jiménez Muñoz').text).toBe('Jiménez Muñoz');
  });

  it.each([
    ['• punto', '* punto', ['•']],
    ['edad ≥ 18', 'edad >= 18', ['≥']],
    ['monto ≤ 5', 'monto <= 5', ['≤']],
    ['a ≠ b', 'a != b', ['≠']],
    ['paso → fin', 'paso -> fin', ['→']],
    ['“cita” y ‘otra’', '"cita" y \'otra\'', ['“', '”', '‘', '’']],
    ['5 − 3', '5 - 3', ['−']],
    ['a b c', 'a b c', [' ', ' ']],
    ['col1\tcol2', 'col1 col2', ['\t']],
  ])('approximates %j', (input, text, replaced) => {
    expect(toWinAnsi(input)).toEqual({ text, replaced, dropped: [] });
  });

  it('drops emoji and CJK and lists each once', () => {
    const out = toWinAnsi('Hola 😀 mundo 中文 😀');
    expect(out.text).toBe('Hola  mundo  ');
    expect(out.dropped).toEqual(['😀', '中', '文']);
  });

  it('drops invisible joiners silently (no warning for what nobody sees)', () => {
    expect(toWinAnsi('a​b﻿c👍️')).toEqual({ text: 'abc', replaced: [], dropped: ['👍'] });
  });

  it('keeps line breaks and tags intact', () => {
    const s = '# RESUELVE\n[PERSONA_1] y [EMPRESA_2]';
    expect(toWinAnsi(s).text).toBe(s);
  });

  it('never throws on odd input', () => {
    for (const bad of ['', '\uD800', '\u0000\u0007', 'x'.repeat(10000), null, undefined, 42]) {
      expect(() => toWinAnsi(bad)).not.toThrow();
    }
    expect(toWinAnsi('\uD800a').text).toBe('a');
    expect(toWinAnsi(null).text).toBe('');
  });
});
