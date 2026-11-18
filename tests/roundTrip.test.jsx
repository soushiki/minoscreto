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
import { stripAiHeader, stripPageMarkers } from '../src/model/expediente/render.js';

// T11 ida y vuelta (S1–S3, R1–R3): PDF con contraseña → anonimizar → .pdf sin contraseña → restaurar → texto original.
// Otro PDF: ROUNDTRIP_PDF=<ruta> ROUNDTRIP_PASSWORD=<clave> ROUNDTRIP_OUT=<carpeta> (guarda los PDF para abrirlos).
vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));

const SOURCE = process.env.ROUNDTRIP_PDF || 'tests/fixtures/contrasena_usuario_sintetico.pdf';
const PASSWORD = process.env.ROUNDTRIP_PASSWORD ?? 'minoscreto-prueba';
const OUT = process.env.ROUNDTRIP_OUT || '';
const STEM = basename(SOURCE).replace(/\.pdf$/i, '');

let saved;
const blobNamed = (pattern) => saved.find((s) => s.name && pattern.test(s.name));
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

// S1/S2: la contraseña no queda en almacenamiento, consola, URL, página ni archivos descargados.
const CONSOLE = ['log', 'info', 'debug', 'warn', 'error'];
let consoleCalls;
async function expectPasswordNowhere(where) {
  if (!PASSWORD) return;
  const stored = [window.localStorage, window.sessionStorage]
    .flatMap((s) => Object.keys(s).flatMap((k) => [k, s.getItem(k)]));
  const files = await Promise.all(saved.map(async (s) => `${s.name}\n${await s.blob.text()}`));
  const places = {
    storage: stored.join('\n'),
    console: consoleCalls.map((args) => args.map(String).join(' ')).join('\n'),
    url: window.location.href,
    page: document.documentElement.outerHTML + [...document.querySelectorAll('input')].map((i) => i.value).join('\n'),
    files: files.join('\n'),
  };
  for (const [place, text] of Object.entries(places)) expect(text, `${where}: contraseña en ${place}`).not.toContain(PASSWORD);
}

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
  consoleCalls = [];
  for (const m of CONSOLE) {
    const original = console[m].bind(console);
    vi.spyOn(console, m).mockImplementation((...args) => { consoleCalls.push(args); original(...args); });
  }
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
    await waitFor(() => expect(blobNamed(/_diccionario-[A-Z0-9]{4}\.json$/)).toBeTruthy(), { timeout: DICTIONARY_DELAY + 5000 });
    const dictFile = blobNamed(/_diccionario-[A-Z0-9]{4}\.json$/);
    const code = dictFile.name.slice(-9, -5);
    // FIX-10: el PDF para la IA tiene nombre neutro con el mismo código; el diccionario conserva el nombre real.
    expect(dictFile.name).toBe(`${STEM}_diccionario-${code}.json`);
    const protectedPdf = blobNamed(/_protegido\.pdf$/);
    expect(protectedPdf?.name).toBe(`documento-${code}_protegido.pdf`);
    const dictText = await dictFile.blob.text();
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
    await expectPasswordNowhere('tras anonimizar');

    // 2. Restaurar ese .pdf con el diccionario, en una app nueva.
    cleanup();
    window.localStorage.clear();
    const firstRound = saved.length;
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Recuperar los nombres reales/ }));
    fireEvent.change(document.querySelector('input[type="file"][accept*=".zip"]'),
      { target: { files: [new File([dictText], dictFile.name)] } });
    await waitFor(() => expect(document.body.textContent).toMatch(/\d+ etiquetas/));
    await user.click(screen.getByRole('button', { name: 'Archivo' }));
    fireEvent.change(document.querySelector('input[type="file"][accept*=".pdf"]'),
      { target: { files: [new File([protectedBytes], protectedPdf.name, { type: 'application/pdf' })] } });
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF restaurado' }, { timeout: 30000 }));
    await waitFor(() => expect(saved.length).toBe(firstRound + 1));
    const restored = saved[saved.length - 1];
    expect(restored.name).toBe(`${STEM}-restaurado.pdf`); // nombre real, sacado del diccionario
    expect(document.body.textContent).not.toContain('Sin entrada en el diccionario');

    const restoredBytes = await bytesOf(restored.blob);
    const rest = await pdfText(restoredBytes);
    expect(rest.encrypted).toBe(false);
    const restText = stripFooters(rest.pages);
    // Completo: igual al texto anonimizado con cada etiqueta cambiada por su valor real, y ninguna etiqueta queda.
    // Sin el encabezado para la IA: el título es «Documento» (FIX-3), sin «(anonimizado)» ni notas de etiquetas.
    expect(restText).toBe(expectedFrom(stripPageMarkers(stripAiHeader(restoreText(md, dict).text))));
    expect(restText).not.toMatch(/\[[A-Z_]+_\d+\]/);
    expect(restText).not.toMatch(/\[(?:Folio|Página)s? /);
    expect(restText).not.toMatch(/anonimizado|\[PERSONA_N\]|etiquetas entre corchetes|Expediente completo/);
    expect(restText.startsWith('Documento')).toBe(true);
    expect(protText).not.toContain(STEM); // FIX-3: el nombre del archivo no llega a la IA

    // Y frente al PDF original: cada valor real vuelve tantas veces como su etiqueta aparecía.
    const original = stripFooters((await pdfText(new Uint8Array(readFileSync(SOURCE)), PASSWORD || undefined)).pages);
    for (const [tag, value] of values) {
      const times = tagsInMd.filter((t) => t === tag).length;
      const forms = variants[tag] ? [...new Set(variants[tag])] : [String(value)];
      const found = forms.reduce((n, f) => n + restText.split(expectedFrom(f)).length - 1, 0);
      if (times) expect(found, `${tag} → ${forms.join(' / ')}`).toBeGreaterThanOrEqual(times);
    }
    expect(original.length).toBeGreaterThan(0);
    await expectPasswordNowhere('tras restaurar');

    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, protectedPdf.name), protectedBytes);
      writeFileSync(join(OUT, restored.name), restoredBytes);
      writeFileSync(join(OUT, `${STEM}_comparacion.txt`),
        `ORIGINAL (texto del PDF de entrada)\n${original}\n\nANONIMIZADO (.pdf)\n${protText}\n\nRESTAURADO (.pdf)\n${restText}\n`);
    }
  }, 120000);
});
