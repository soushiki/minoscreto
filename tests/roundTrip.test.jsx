import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import App from '../src/App.jsx';
import { goToTools } from './helpers.js';
import { readDictionaryFrom, restoreText } from '../src/model/index.js';
import { dictionaryVariants } from '../src/model/dictionary.js';
import { toWinAnsi } from '../src/model/pdf/winAnsi.js';
import { DICTIONARY_DELAY } from '../src/viewmodels/useProtectedDownload.js';

// T11 ida y vuelta (S1–S3, R1–R3): PDF con contraseña → anonimizar → .pdf sin contraseña → restaurar → texto original.
// Otro PDF: ROUNDTRIP_PDF=<ruta> ROUNDTRIP_PASSWORD=<clave> ROUNDTRIP_OUT=<carpeta> (guarda los PDF para abrirlos).
vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));

const SOURCE = process.env.ROUNDTRIP_PDF || 'tests/fixtures/contrasena_usuario_sintetico.pdf';
const PASSWORD = process.env.ROUNDTRIP_PASSWORD ?? 'minoscreto-prueba';
const OUT = process.env.ROUNDTRIP_OUT || '';
const STEM = basename(SOURCE).replace(/\.pdf$/i, '');

let saved;
const blobNamed = (suffix) => saved.find((s) => s.name?.endsWith(suffix));
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

async function pdfText(bytes, password) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) pages.push((await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(' '));
  return { pages, encrypted: Boolean((await pdf.getMetadata()).info?.IsEncrypted) };
}
// Lo que el escritor cambia a propósito: sin «# » de título, caracteres WinAnsi, pie «Página n de N», espacios.
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const expectedFrom = (text) => norm(toWinAnsi(text.split('\n').map((l) => l.replace(/^#+\s+/, '')).join('\n')).text);
const stripFooters = (pages) => norm(pages.map((p) => p.replace(/Página \d+ de \d+\s*$/, '')).join(' '));

beforeAll(() => {
  window.scrollTo = () => {};
  window.ResizeObserver = window.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});
beforeEach(() => {
  window.localStorage.clear();
  saved = [];
  URL.createObjectURL = vi.fn((blob) => { saved.push({ blob }); return 'blob:prueba'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { saved[saved.length - 1].name = this.download; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ida y vuelta PDF (T11)', () => {
  it(`${STEM}: anonimiza, descarga .pdf sin contraseña y lo restaura completo`, async () => {
    const user = userEvent.setup();
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn((t) => { copied = t; return Promise.resolve(); }) }, configurable: true });

    // 1. Anonimizar el PDF con contraseña.
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'),
      { target: { files: [new File([readFileSync(SOURCE)], `${STEM}.pdf`)] } });
    if (PASSWORD) {
      await waitFor(() => expect(document.querySelector('dialog[open] input')).toBeTruthy(), { timeout: 15000 });
      await user.type(document.querySelector('dialog[open] input'), `${PASSWORD}{Enter}`);
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar texto para la IA' }).disabled).toBe(false), { timeout: 60000 });
    await user.click(screen.getByRole('button', { name: 'Copiar texto para la IA' }));
    await waitFor(() => expect(copied).not.toBe(''));
    await user.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(blobNamed('_diccionario.json')).toBeTruthy(), { timeout: DICTIONARY_DELAY + 5000 });
    const protectedPdf = blobNamed('_protegido.pdf');
    expect(protectedPdf).toBeTruthy();
    const dictText = await blobNamed('_diccionario.json').blob.text();
    const dict = await readDictionaryFrom(new TextEncoder().encode(dictText));
    const variants = dictionaryVariants(dict);
    const md = copied;
    const tagsInMd = md.match(/\[[A-Z_]+_\d+\]/g) || [];
    expect(tagsInMd.length).toBeGreaterThan(0);
    // Toda etiqueta del texto tiene su entrada: el párrafo de instrucciones para la IA usa ejemplos genéricos ([PERSONA_N]).
    expect([...new Set(tagsInMd.filter((t) => !Object.hasOwn(dict, t)))]).toEqual([]);
    expect(md).toContain('[PERSONA_N]');

    // El .pdf protegido: sin contraseña, sin ningún valor real del diccionario, con todas las etiquetas.
    const protectedBytes = await bytesOf(protectedPdf.blob);
    const prot = await pdfText(protectedBytes);
    expect(prot.encrypted).toBe(false);
    const protText = stripFooters(prot.pages);
    const values = Object.entries(dict);
    expect(values.length).toBeGreaterThan(0);
    for (const [, value] of values) expect(protText).not.toContain(String(value));
    expect(protText).toBe(expectedFrom(md));

    // 2. Restaurar ese .pdf con el diccionario, en una app nueva.
    cleanup();
    window.localStorage.clear();
    const firstRound = saved.length;
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Recuperar los nombres reales/ }));
    fireEvent.change(document.querySelector('input[type="file"][accept*=".zip"]'),
      { target: { files: [new File([dictText], `${STEM}_diccionario.json`)] } });
    await waitFor(() => expect(document.body.textContent).toMatch(/\d+ etiquetas/));
    await user.click(screen.getByRole('button', { name: 'Archivo' }));
    fireEvent.change(document.querySelector('input[type="file"][accept*=".pdf"]'),
      { target: { files: [new File([protectedBytes], `${STEM}_protegido.pdf`, { type: 'application/pdf' })] } });
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF restaurado' }, { timeout: 30000 }));
    await waitFor(() => expect(saved.length).toBe(firstRound + 1));
    const restored = saved[saved.length - 1];
    expect(restored.name).toBe(`${STEM}_protegido-restaurado.pdf`);
    expect(document.body.textContent).not.toContain('Sin entrada en el diccionario');

    const restoredBytes = await bytesOf(restored.blob);
    const rest = await pdfText(restoredBytes);
    expect(rest.encrypted).toBe(false);
    const restText = stripFooters(rest.pages);
    // Completo: igual al texto anonimizado con cada etiqueta cambiada por su valor real, y ninguna etiqueta queda.
    expect(restText).toBe(expectedFrom(restoreText(md, dict).text));
    expect(restText).not.toMatch(/\[[A-Z_]+_\d+\]/);
    expect(restText).toContain('[PERSONA_N]'); // el ejemplo genérico no se toca al restaurar

    // Y frente al PDF original: cada valor real vuelve tantas veces como su etiqueta aparecía.
    const original = stripFooters((await pdfText(new Uint8Array(readFileSync(SOURCE)), PASSWORD || undefined)).pages);
    for (const [tag, value] of values) {
      const times = tagsInMd.filter((t) => t === tag).length;
      const forms = variants[tag] ? [...new Set(variants[tag])] : [String(value)];
      const found = forms.reduce((n, f) => n + restText.split(expectedFrom(f)).length - 1, 0);
      if (times) expect(found, `${tag} → ${forms.join(' / ')}`).toBeGreaterThanOrEqual(times);
    }
    expect(original.length).toBeGreaterThan(0);

    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${STEM}_protegido.pdf`), protectedBytes);
      writeFileSync(join(OUT, `${STEM}_protegido-restaurado.pdf`), restoredBytes);
      writeFileSync(join(OUT, `${STEM}_comparacion.txt`),
        `ORIGINAL (texto del PDF de entrada)\n${original}\n\nANONIMIZADO (.pdf)\n${protText}\n\nRESTAURADO (.pdf)\n${restText}\n`);
    }
  }, 120000);
});
