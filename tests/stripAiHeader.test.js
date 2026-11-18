import { describe, it, expect, vi } from 'vitest';
import { writeTextPdf } from '../src/model/pdf/writer.js';
import { readPdfPages } from '../src/model/expediente/pdfjs.js';

vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));
import { renderWhole, renderParts, stripAiHeader, stripPageMarkers } from '../src/model/expediente/render.js';

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

  // Pedido del usuario 2026-11-18: el documento original no tiene marcas [Folio N]; el PDF restaurado tampoco.
  it('stripPageMarkers quita las líneas [Folio N] / [Página N] y «sin texto legible»; deja citas dentro de frases y […]', () => {
    const text = renderWhole({ name: 'Caso', blocks: [...blocks, { index: 5, page: 6, text: 'Final, ver [Folio 2] arriba.' }],
      emptyPages: [3, 4, 5], unit: 'folio' });
    const out = stripPageMarkers(stripAiHeader(text));
    expect(out).not.toMatch(/^\s*\[Folio \d+\]\s*$/m);
    expect(out).not.toMatch(/sin texto legible/);
    expect(out).toContain('Final, ver [Folio 2] arriba.');
    expect(out).not.toMatch(/\n{3,}/);
    const pages = stripPageMarkers('[Página 1]\n\nUno.\n\n[Página 2]\n\nDos.\n');
    expect(pages).toBe('Uno.\n\nDos.\n');
    const sel = renderWhole({ name: 'Caso', blocks: [blocks[0], blocks[2]], emptyPages: [], selection: true, unit: 'folio' });
    expect(stripPageMarkers(stripAiHeader(sel))).toContain('[…]');
  });

  it('un texto que no empieza con nuestro encabezado no cambia, aunque tenga esas frases más abajo', () => {
    const own = 'Informe (anonimizado) del juzgado\n\nExpediente completo · folios 1–3';
    expect(stripAiHeader(own)).toBe(own);
    const body = 'Respuesta de la IA.\n\n# Expediente (anonimizado)\n\nExpediente completo · folio 1';
    expect(stripAiHeader(body)).toBe(body);
  });

  // FIX-2 (6-test 2026-11-18): un nombre largo se parte en dos renglones en el PDF y puede traer corchetes.
  it('quita el encabezado cuando el título largo (70 caracteres, con [ ]) se parte en el PDF escrito y leído', async () => {
    const name = 'Tutela [2026-00123] Juzgado Segundo Civil Municipal de Cartagena final';
    expect(name).toHaveLength(70);
    const md = renderWhole({ name, blocks, emptyPages: [], unit: 'folio' });
    const { bytes } = await writeTextPdf({ lines: md.split('\n') });
    const pages = await readPdfPages(bytes, {});
    const text = pages.map((p) => p.lines.map((l) => (typeof l === 'string' ? l : l.text)).join('\n')).join('\n');
    expect(text.split('\n').findIndex((l) => l.includes('(anonimizado)'))).toBeGreaterThan(0); // de verdad se partió
    const out = stripAiHeader(text);
    expect(out.startsWith(`# ${name}\n\n`)).toBe(true);
    expect(out).not.toMatch(/anonimizado|Expediente\s+completo|etiquetas\s+entre|\[PERSONA_N\]|marca\s+dónde/);
    expect(out).toContain('CONTRATO DE ARRENDAMIENTO');
  }, 20000);

  it('un título entre líneas en blanco no se une con el párrafo anterior', () => {
    const text = 'Informe del juzgado\n\nCaso (anonimizado)\n\nExpediente completo · folio 1';
    expect(stripAiHeader(text)).toBe(text);
  });
});
