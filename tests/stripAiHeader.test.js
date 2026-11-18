import { describe, it, expect } from 'vitest';
import { renderWhole, renderParts, stripAiHeader } from '../src/model/expediente/render.js';

// Pedido del usuario 2026-11-18: el PDF restaurado seguía diciendo «(anonimizado)» y traía las notas para la IA.
const blocks = [
  { index: 0, page: 1, text: 'CONTRATO DE ARRENDAMIENTO', heading: true },
  { index: 1, page: 1, text: 'Entre [PERSONA_1] y [EMPRESA_1] se celebra este contrato.' },
  { index: 2, page: 2, text: 'Segunda cláusula del contrato.' }
];
// Como lo devuelve un PDF: renglones partidos en cualquier palabra y el «# » del título ya dibujado en negrita.
const asPdfLines = (text) => text.replace(/^# /gm, '').split(' ').map((w, i) => (i % 7 === 6 ? `${w}\n` : `${w} `)).join('');

describe('stripAiHeader', () => {
  for (const unit of ['folio', 'pagina', 'parrafo']) {
    it(`quita título «(anonimizado)», alcance y notas (${unit}); deja el nombre como título y el cuerpo intacto`, () => {
      const text = renderWhole({ name: 'Expediente 2026-001', blocks, emptyPages: [], unit });
      const out = stripAiHeader(text);
      expect(out.startsWith('# Expediente 2026-001\n\n')).toBe(true);
      expect(out).not.toMatch(/anonimizado|Expediente completo|etiquetas entre corchetes|\[PERSONA_N\]|marca dónde/);
      expect(out).toContain('CONTRATO DE ARRENDAMIENTO');
      expect(out).toContain('Entre [PERSONA_1] y [EMPRESA_1] se celebra este contrato.');
    });
  }

  it('también con los renglones partidos como los lee el PDF', () => {
    const text = asPdfLines(renderWhole({ name: 'Expediente 2026-001', blocks, emptyPages: [], selection: true, unit: 'folio' }));
    const out = stripAiHeader(text);
    expect(out.startsWith('# Expediente 2026-001\n\n')).toBe(true);
    expect(out).not.toMatch(/anonimizado|Pasajes\s+seleccionados|etiquetas\s+entre|\[Folio\s+N\]\s+marca/);
    expect(out.replace(/\s+/g, ' ')).toContain('Entre [PERSONA_1] y [EMPRESA_1] se celebra este contrato.');
  });

  it('en una parte quita «Parte n de N», la instrucción, las notas y el aviso de solapamiento', () => {
    const parts = renderParts({ blocks, parts: [{ from: 0, overlapFrom: 0, to: 2 }, { from: 2, overlapFrom: 1, to: 3 }], emptyPages: [], unit: 'folio' });
    for (const p of parts) {
      const out = stripAiHeader(asPdfLines(p.text));
      expect(out).not.toMatch(/Parte\s+\d|Instrucción|etiquetas\s+entre|párrafo\s+repite|marca\s+dónde/);
      expect(out.trim().length).toBeGreaterThan(0);
    }
  });

  it('un texto que no empieza con nuestro encabezado no cambia, aunque tenga esas frases más abajo', () => {
    const own = 'Informe (anonimizado) del juzgado\n\nExpediente completo · folios 1–3';
    expect(stripAiHeader(own)).toBe(own);
    const body = 'Respuesta de la IA.\n\n# Expediente (anonimizado)\n\nExpediente completo · folio 1';
    expect(stripAiHeader(body)).toBe(body);
  });
});
