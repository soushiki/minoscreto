// @vitest-environment node
// unlockPdf (ADR-009): PDFium real en el mismo proceso; la copia sin clave se lee con pdf.js sin preguntar nada.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { createPdfium } from '../src/engine-worker/pdfium.js';
import { unlockPdf } from '../src/model/layout/unlock.js';
import { readPdfPages } from '../src/model/expediente/pdfjs.js';

vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));
vi.mock('virtual:minoscreto-engine', () => ({ ENGINE: null }));

const PASSWORD = 'minoscreto-prueba';
const locked = () => new Uint8Array(readFileSync(join(resolve(__dirname, '..'), 'tests/fixtures/contrasena_usuario_sintetico.pdf')));
const textOf = (pages) => pages.flatMap((p) => p.lines.map((l) => (typeof l === 'string' ? l : l.text ?? ''))).join(' ');

let runtime;
beforeAll(async () => { runtime = await createPdfRuntime({ prefer: 'wasm' }); }, 30000);

function engineFor() {
  const pdfium = createPdfium(runtime);
  const calls = [];
  const client = {
    open: async (bytes, password) => { calls.push('open'); return pdfium.open(new Uint8Array(bytes), password); },
    save: async () => { calls.push('save'); return pdfium.save(); },
    close: async () => { calls.push('close'); return pdfium.close(); },
    alive: true
  };
  return { loadEngine: async () => client, calls };
}

describe('unlockPdf (ADR-009)', () => {
  it('con la contraseña buena da bytes que se leen sin pedir contraseña y con el mismo texto', async () => {
    const { loadEngine, calls } = engineFor();
    const bytes = locked();
    const unlocked = await unlockPdf({ bytes, password: PASSWORD, loadEngine });
    expect(unlocked).toBeInstanceOf(Uint8Array);
    expect(calls).toEqual(['open', 'save', 'close']);
    const lockedPages = await readPdfPages(bytes.slice(), { askPassword: async () => PASSWORD });
    const askPassword = vi.fn(async () => null);
    const pages = await readPdfPages(unlocked.slice(), { askPassword });
    expect(askPassword).not.toHaveBeenCalled();
    expect(textOf(pages)).toBe(textOf(lockedPages));
    expect(textOf(pages).length).toBeGreaterThan(0);
  });

  it('con una contraseña equivocada rechaza (no abrió nada que cerrar) y el siguiente turno sigue funcionando', async () => {
    const { loadEngine, calls } = engineFor();
    await expect(unlockPdf({ bytes: locked(), password: 'otra', loadEngine })).rejects.toBeTruthy();
    expect(calls).toEqual(['open']);
    // el turno siguiente sigue funcionando (el worker no quedó trabado)
    const again = engineFor();
    await expect(unlockPdf({ bytes: locked(), password: PASSWORD, loadEngine: again.loadEngine })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('si guardar falla, igual cierra el documento y rechaza', async () => {
    const calls = [];
    const client = { open: async () => {}, save: async () => { throw new Error('boom'); }, close: async () => { calls.push('close'); } };
    await expect(unlockPdf({ bytes: locked(), password: PASSWORD, loadEngine: async () => client })).rejects.toThrow('boom');
    expect(calls).toEqual(['close']);
  });

  it('un error al cerrar no tapa los bytes ya guardados', async () => {
    const saved = new Uint8Array([1, 2, 3]);
    const client = { open: async () => {}, save: async () => saved, close: async () => { throw new Error('cerrar'); } };
    await expect(unlockPdf({ bytes: locked(), password: PASSWORD, loadEngine: async () => client })).resolves.toBe(saved);
  });
});
