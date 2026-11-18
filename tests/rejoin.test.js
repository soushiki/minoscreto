import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { rejoinTags } from '../src/model/pdf/rejoin.js';
import { itemsToLines } from '../src/model/expediente/layout.js';

const dict = {
  '[PERSONA_1]': 'Ana Gómez', '[PERSONA_2]': 'Luis Pérez', '[EMPRESA_1]': 'Acme SAS',
  '[DIRECCION_1]': 'Calle 1 # 2-3', '[CEDULA_1]': '123', '[TELEFONO_1]': '300'
};

async function fixtureText(name) {
  const data = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', `${name}.pdf`)));
  const pdf = await getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(itemsToLines(content.items).map((l) => l.text).join('\n'));
  }
  return pages.join('\n');
}

describe('rejoinTags (C5, R5)', () => {
  it.each([
    ['soft hyphen', '[PERSO­NA_1] dijo', '[PERSONA_1] dijo', 0],
    ['space inside the brackets', 'hola [PERSONA _1] y [ EMPRESA_1 ]', 'hola [PERSONA_1] y [EMPRESA_1]', 2],
    ['newline inside the brackets', 'a [PERSONA_\n1] b', 'a [PERSONA_1] b', 1],
    ['line end with hyphen', 'a [EMPRE-\nSA_1] el pago', 'a [EMPRESA_1] el pago', 1],
    ['line end without hyphen', 'a [PERSONA_\n2] pidió', 'a [PERSONA_2] pidió', 1],
    ['bracket alone at line end', 'a [\nPERSONA_1] b', 'a [PERSONA_1] b', 1],
    ['two joins on one logical line', '[EMPRE-\nSA_1] y [PERSONA_\n2] ok', '[EMPRESA_1] y [PERSONA_2] ok', 2],
    ['trailing spaces and CRLF', 'a [PERSONA_ \r\n1] b', 'a [PERSONA_1] b', 1]
  ])('%s', (_, input, text, joined) => {
    expect(rejoinTags(input, dict)).toEqual({ text, joined, broken: [] });
  });

  it('never joins to a key that is not in the dictionary: reports broken and leaves the text', () => {
    const input = 'a [PERSONA_\n9] b';
    expect(rejoinTags(input, dict)).toEqual({ text: input, joined: 0, broken: ['[PERSONA_9]'] });
  });

  it('reports a dangling fragment at the end of the text', () => {
    expect(rejoinTags('fin [PERSONA_', dict)).toEqual({ text: 'fin [PERSONA_', joined: 0, broken: ['[PERSONA_'] });
  });

  it('does not join whole tags or ordinary bracketed text', () => {
    const input = 'Ver [PERSONA_1].\n[nota\nsiguiente] y [Nota del\neditor] fin';
    expect(rejoinTags(input, dict)).toEqual({ text: input, joined: 0, broken: [] });
  });

  it('handles empty input and an empty dictionary', () => {
    expect(rejoinTags('', {})).toEqual({ text: '', joined: 0, broken: [] });
    expect(rejoinTags('a [PERSONA_\n1] b', undefined).joined).toBe(0);
  });
});

describe('rejoinTags on the T1 fixtures', () => {
  it('etiquetas_fin_de_linea_sintetico.pdf: every cut tag is glued, normal brackets stay', async () => {
    const out = rejoinTags(await fixtureText('etiquetas_fin_de_linea_sintetico'), dict);
    expect(out.joined).toBe(3);
    expect(out.broken).toEqual([]);
    for (const k of ['[EMPRESA_1]', '[PERSONA_2]', '[DIRECCION_1]']) expect(out.text).toContain(k);
    expect(out.text).toContain('[entre corchetes\ny con salto]');
  });

  it('chrome_guardar_como_sintetico.pdf: the table cell [DIRECCION_ / 1] is glued', async () => {
    const out = rejoinTags(await fixtureText('chrome_guardar_como_sintetico'), dict);
    expect(out.joined).toBeGreaterThanOrEqual(1);
    expect(out.broken).toEqual([]);
    expect(out.text).toContain('[DIRECCION_1][CEDULA_1]');
  });
});

describe('ADR-003 fitness', () => {
  const spanish = [
    'El artículo 5 del Código Civil [vigente] establece que',
    'la cuota se paga [según el numeral 3\ndel acuerdo] en la fecha pactada.',
    'Cita: [1] Sentencia C-123 de 2020; [2] Ley 100 de 1993.',
    '[Nota del editor:\nse omite el resto] Fin del párrafo.',
    'Sin corchetes, solo texto.\nOtra línea con tilde y ñ.\n\n  sangría  y espacios  '
  ].join('\n');

  it('ADR-003: rejoin must not change text without brackets / ordinary bracketed text is byte-identical', () => {
    const out = rejoinTags(spanish, dict);
    expect(out.text).toBe(spanish);
    expect(out.joined).toBe(0);
    expect(out.broken).toEqual([]);
  });

  it('ADR-003: restore regex is ask-first (PLACEHOLDER pattern unchanged)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'model', 'docx', 'restore.js'), 'utf8');
    expect(src).toContain('const PLACEHOLDER = /\\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9_ ]{1,40}\\]/g;');
  });
});
