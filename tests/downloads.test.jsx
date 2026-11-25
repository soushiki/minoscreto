import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import App from '../src/App.jsx';
import { goToTools } from './helpers.js';
import {
  buildDocx, buildEntities, buildDictionary, bundleFileName, dictionaryFileName, exportCode, nameFromDictionary, protectedFileName, readDictionaryFrom
} from '../src/model/index.js';
import { buildPartsZip, renderParts, splitParts, anonymizeTexts } from '../src/model/expediente/index.js';
import { DICTIONARY_DELAY } from '../src/viewmodels/useProtectedDownload.js';
import { isAppleTouch } from '../src/viewmodels/platform.js';
import { LAYOUT_FALLBACK, LAYOUT_OK, LAYOUT_PREPARING } from '../src/viewmodels/messages.js';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createPdfium } from '../src/engine-worker/pdfium.js';

// jsdom no tiene Worker: pdf.js corre su build legacy en el mismo hilo (como en passwordDialog.test.jsx).
// slowFirstDestroy: la primera lectura tarda en rechazar tras cancelarse, para que su `finally` llegue después de la pregunta del archivo nuevo.
const slow = vi.hoisted(() => ({ on: false, calls: 0 }));
vi.mock('pdfjs-dist', async () => {
  const real = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return {
    ...real,
    GlobalWorkerOptions: {},
    getDocument: (...args) => {
      const task = real.getDocument(...args);
      if (slow.on && slow.calls++ === 0) {
        const original = task.promise;
        Object.defineProperty(task, 'promise', {
          value: original.catch((e) => new Promise((_, reject) => setTimeout(() => reject(e), 1500)))
        });
      }
      return task;
    }
  };
});
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));
// T11: el motor del PDF con diseño. Sin `engine.load` el cargador real falla (ENGINE es null fuera del build) →
// PDF de texto con el aviso «engine». Con `engine.load`, PDFium real en el mismo proceso (como tests/protect.test.js).
const engine = vi.hoisted(() => ({ load: null }));
vi.mock('../src/model/engine/loader.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadEngine: (...args) => (engine.load ? engine.load(...args) : actual.loadEngine(...args)) };
});

const encode = (s) => new TextEncoder().encode(s);
let downloads;

beforeAll(() => {
  window.scrollTo = () => {};
  window.ResizeObserver = window.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});
beforeEach(() => {
  window.localStorage.clear();
  downloads = [];
  URL.createObjectURL = vi.fn(() => 'blob:prueba');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { downloads.push(this.download); });
});
afterEach(() => { slow.on = false; engine.load = null; cleanup(); vi.restoreAllMocks(); });

const mockClipboard = () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
};

async function partsZip() {
  const texts = ['El señor Carlos Andrés Mendoza Ríos demandó.', 'Carlos Andrés Mendoza Ríos insistió.'];
  const entities = buildEntities(texts.map((text) => ({ text })));
  const applied = anonymizeTexts(texts, entities);
  const blocks = applied.texts.map((text, index) => ({ index, page: index + 1, text }));
  const rendered = renderParts({ blocks, parts: splitParts(blocks, { mode: 'pages', pagesPerPart: 1 }), emptyPages: [] });
  return buildPartsZip({ name: 'caso', code: '7F3K', parts: rendered, dictionary: buildDictionary(entities, new Set(applied.usedIds)), type: 'uint8array' });
}

async function wordWithTwoPages(name = 'caso.docx') {
  const zip = new JSZip();
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (t, pre = '') => `<w:p><w:r>${pre}<w:t>${t}</w:t></w:r></w:p>`;
  zip.file('word/document.xml', `<w:document ${w}><w:body>${p('La señora Laura Patricia Ortega Jiménez demandó.')}${p('Laura Patricia Ortega Jiménez firmó.', '<w:lastRenderedPageBreak/>')}</w:body></w:document>`);
  return new File([await zip.generateAsync({ type: 'uint8array' })], name);
}

// FIX-10: código de 4 caracteres sin 0/O ni 1/I/L que empareja el archivo para la IA con su diccionario.
const CODE = '[2-9A-HJKMNP-Z]{4}';
const codeIn = (name) => new RegExp(CODE).exec(name.replace(/^documento-/, '').replace(/^.*_diccionario-/, ''))?.[0];

describe('archivos protegidos', () => {
  it('lo que va a la IA tiene nombre neutro; lo que se guarda en casa, el nombre real y el mismo código', () => {
    expect(protectedFileName('7F3K', 'docx')).toBe('documento-7F3K_protegido.docx');
    expect(dictionaryFileName('Contrato: arriendo', '7F3K')).toBe('Contrato- arriendo_diccionario-7F3K.json');
    expect(bundleFileName('Tutela Juan Pérez', '7F3K')).toBe('Tutela Juan Pérez-7F3K.zip');
  });

  it('exportCode da 4 caracteres legibles y cambia de una exportación a otra', () => {
    const codes = new Set(Array.from({ length: 50 }, exportCode));
    for (const c of codes) expect(c).toMatch(new RegExp(`^${CODE}$`));
    expect(codes.size).toBeGreaterThan(40);
  });

  it('nameFromDictionary saca el nombre real de nuestro diccionario; de otro nombre, null', () => {
    expect(nameFromDictionary('Tutela Juan Pérez_diccionario-7F3K.json')).toBe('Tutela Juan Pérez');
    expect(nameFromDictionary('Tutela Juan Pérez_diccionario-7F3K (1).json')).toBe('Tutela Juan Pérez');
    expect(nameFromDictionary('caso_diccionario.txt')).toBe('caso');
    // El .zip de un expediente en partes también es nuestro: «<nombre>-<código>.zip» (y la copia «(1)» del navegador).
    expect(nameFromDictionary('Tutela Juan Pérez-7F3K.zip')).toBe('Tutela Juan Pérez');
    expect(nameFromDictionary('Tutela Juan Pérez-7F3K (2).zip')).toBe('Tutela Juan Pérez');
    expect(nameFromDictionary(bundleFileName('Caso-3 Ana', exportCode()))).toBe('Caso-3 Ana');
    // Un .zip que no es nuestro no da nombre: sin código, o con 0/1/O/I/L, que nuestro código nunca usa.
    expect(nameFromDictionary('fotos.zip')).toBeNull();
    expect(nameFromDictionary('respaldo-2024.zip')).toBeNull();
    expect(nameFromDictionary('Caso-ABCDE.zip')).toBeNull();
    expect(nameFromDictionary('llave.json')).toBeNull();
    expect(nameFromDictionary('')).toBeNull();
  });

  it('lee el diccionario desde el .json, el .txt o el .zip de un expediente en partes', async () => {
    expect(await readDictionaryFrom(encode('{"[PERSONA_1]": "Ana"}'))).toEqual({ '[PERSONA_1]': 'Ana' });
    expect(await readDictionaryFrom(encode('[PERSONA_1]: Ana\n'))).toEqual({ '[PERSONA_1]': 'Ana' });
    expect(await readDictionaryFrom(await partsZip())).toEqual({ '[PERSONA_1]': 'Carlos Andrés Mendoza Ríos' });
    await expect(readDictionaryFrom(new Uint8Array(await buildDocx(['Hola'])))).rejects.toThrow(/Word, no el diccionario/);
    const other = new JSZip();
    other.file('otro.txt', 'x');
    await expect(readDictionaryFrom(await other.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/no trae un diccionario/);
  });
});

describe('equipos táctiles de Apple', () => {
  it('reconoce iPhone, iPad (también con iPadOS que se presenta como Mac) y deja fuera Mac y Android', () => {
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)' })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
    expect(isAppleTouch(null)).toBe(false);
  });
});

describe('descarga y copia en la app', () => {
  it('Anonimizar: un clic baja el Word y luego el diccionario, con lista y botón para repetir el diccionario', async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    render(<App />);
    await goToTools(user);
    await waitFor(() => expect(document.body.textContent).toContain('[EMPRESA_1]'), { timeout: 8000 });
    expect(screen.queryByRole('button', { name: /^Diccionario/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(downloads[0]).toMatch(new RegExp(`^documento-${CODE}_protegido\\.docx$`)), { timeout: 4000 });
    const code = codeIn(downloads[0]);
    await waitFor(() => expect(document.querySelector('.dl-receipt')?.textContent).toContain('Guarde el diccionario'));
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: DICTIONARY_DELAY + 2000 });
    expect(downloads[1]).toMatch(new RegExp(`^.+_diccionario-${code}\\.json$`));
    expect(downloads[1].startsWith('documento-')).toBe(false); // el diccionario conserva el nombre real
    await waitFor(() => expect(document.querySelectorAll('.dl-mark.ok')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Descargar diccionario de nuevo' }));
    await waitFor(() => expect(downloads).toHaveLength(3));
    expect(downloads[2]).toBe(downloads[1]);

    await user.click(screen.getByRole('button', { name: 'Copiar texto para la IA' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain('[PERSONA_1]');
    expect(copied).not.toContain('Laura Patricia Ortega');
    await waitFor(() => expect(document.querySelector('.toast').textContent).toMatch(/quedó copiado/));
  }, 20000);

  it('iPhone/iPad: el diccionario espera un toque y solo entonces queda marcado', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', configurable: true });
    try {
      const user = userEvent.setup();
      render(<App />);
      await goToTools(user);
      await waitFor(() => expect(document.body.textContent).toContain('[EMPRESA_1]'), { timeout: 8000 });
      await user.click(screen.getByRole('button', { name: 'Descargar' }));
      await waitFor(() => expect(downloads[0]).toMatch(/_protegido\.docx$/), { timeout: 4000 });
      await new Promise((r) => setTimeout(r, DICTIONARY_DELAY + 300));
      expect(downloads).toHaveLength(1);
      expect(document.querySelectorAll('.dl-mark.ok')).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Descargar diccionario de nuevo' })).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Descargar diccionario' }));
      await waitFor(() => expect(downloads[1]).toMatch(new RegExp(`_diccionario-${codeIn(downloads[0])}\\.json$`)));
      await waitFor(() => expect(document.querySelectorAll('.dl-mark.ok')).toHaveLength(2));
      expect(screen.getByRole('button', { name: 'Descargar diccionario de nuevo' })).toBeTruthy();
    } finally {
      delete navigator.userAgent;
    }
  }, 20000);

  it('Expediente de un archivo: documento y diccionario por separado, en ese orden', async () => {
    const user = userEvent.setup();
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'), { target: { files: [await wordWithTwoPages()] } });
    await waitFor(() => expect(document.querySelector('.xp-pre')).toBeTruthy(), { timeout: 8000 });
    await user.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: DICTIONARY_DELAY + 3000 });
    const code = codeIn(downloads[0]);
    expect(downloads).toEqual([`documento-${code}_protegido.md`, `caso_diccionario-${code}.json`]);
  }, 20000);

  it('FIX-3/FIX-10: un expediente con nombre de persona no deja ese nombre en el archivo ni en el texto para la IA', async () => {
    const user = userEvent.setup();
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'), { target: { files: [await wordWithTwoPages('Tutela Juan Pérez.docx')] } });
    await waitFor(() => expect(document.querySelector('.xp-pre')).toBeTruthy(), { timeout: 8000 });
    const blobs = [];
    URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:prueba'; });
    await user.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: DICTIONARY_DELAY + 3000 });
    const code = codeIn(downloads[0]);
    expect(downloads).toEqual([`documento-${code}_protegido.md`, `Tutela Juan Pérez_diccionario-${code}.json`]);
    const md = await blobs[0].text();
    expect(md.startsWith('# Documento (anonimizado)')).toBe(true);
    for (const word of ['Tutela', 'Juan', 'Pérez']) {
      expect(downloads[0]).not.toContain(word);
      expect(md).not.toContain(word);
    }
  }, 20000);

  describe('PDF con contraseña', () => {
    const RIGHT = 'minoscreto-prueba';
    const pdfFile = () => new File([readFileSync('tests/fixtures/contrasena_usuario_sintetico.pdf')], 'caso.pdf');
    const open = async (user) => {
      render(<App />);
      await goToTools(user);
      await user.click(screen.getByRole('button', { name: 'Expediente' }));
      fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'), { target: { files: [pdfFile()] } });
    };
    const field = () => document.querySelector('dialog input');

    it('pide la contraseña, la acepta y descarga un .pdf cuyo texto es el del Markdown anonimizado', async () => {
      const user = userEvent.setup();
      const blobs = [];
      URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:prueba'; });
      await open(user);
      await waitFor(() => expect(document.querySelector('dialog').hasAttribute('open')).toBe(true), { timeout: 8000 });
      await user.type(field(), `${RIGHT}{Enter}`);
      await waitFor(() => expect(document.querySelector('.xp-pre')).toBeTruthy(), { timeout: 8000 });
      expect(document.querySelector('dialog').hasAttribute('open')).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Descargar' }));
      await waitFor(() => expect(downloads).toHaveLength(2), { timeout: DICTIONARY_DELAY + 3000 });
      const code = codeIn(downloads[0]);
      expect(downloads).toEqual([`documento-${code}_protegido.pdf`, `caso_diccionario-${code}.json`]);
      expect(document.querySelector('.toast')?.textContent ?? '').not.toMatch(/omitieron/);
      // Sin build el motor no carga: PDF de texto con el aviso, sin volver a pedir la contraseña.
      expect(document.querySelector('.dl-fallback').textContent).toBe(LAYOUT_FALLBACK.engine);
      const bytes = new Uint8Array(await blobs[0].arrayBuffer());
      const { readPdfPages } = await import('../src/model/expediente/pdfjs.js');
      const pages = await readPdfPages(bytes);
      const pdfText = pages.flatMap((p) => p.lines.map((l) => (typeof l === 'string' ? l : l.text ?? ''))).join(' ').replace(/\s+/g, ' ');
      const md = document.querySelector('.xp-pre').textContent.replace(/\s+/g, ' ');
      expect(pdfText.length).toBeGreaterThan(20);
      for (const word of md.split(' ').filter((w) => w.length > 3)) expect(pdfText).toContain(word);
      expect(pdfText).toMatch(/\[[A-Z_]+_\d+\]/);
    }, 30000);

    it('soltar otro archivo mientras se pide la contraseña deja abierta la pregunta del nuevo', async () => {
      const user = userEvent.setup();
      slow.on = true; slow.calls = 0;
      await open(user);
      await waitFor(() => expect(document.querySelector('dialog').hasAttribute('open')).toBe(true), { timeout: 8000 });
      // Durante la lectura no hay selector de archivo: el segundo archivo llega soltándolo en la ventana.
      fireEvent.drop(window, { dataTransfer: { files: [pdfFile()], types: ['Files'] } });
      await new Promise((r) => setTimeout(r, 2500));
      expect(document.querySelector('dialog').hasAttribute('open')).toBe(true);
      await user.type(field(), `${RIGHT}{Enter}`);
      await waitFor(() => expect(document.querySelector('.xp-pre')).toBeTruthy(), { timeout: 8000 });
    }, 30000);

    it('Cancelar en el diálogo corta la lectura sin aviso y vuelve a la pantalla inicial', async () => {
      const user = userEvent.setup();
      await open(user);
      await waitFor(() => expect(document.querySelector('dialog').hasAttribute('open')).toBe(true), { timeout: 8000 });
      await user.click(within(document.querySelector('dialog')).getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(document.querySelector('dialog').hasAttribute('open')).toBe(false));
      await waitFor(() => expect(screen.getByText('Expediente en PDF o Word')).toBeTruthy());
      expect(document.querySelector('.toast')).toBeNull();
    }, 20000);
  });

  it('Expediente en partes: un botón de copiar por parte y un .zip con todo', async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'), { target: { files: [await wordWithTwoPages()] } });
    await waitFor(() => expect(document.querySelector('.xp-pre')).toBeTruthy(), { timeout: 8000 });
    await user.click(screen.getByRole('button', { name: 'Por páginas' }));
    fireEvent.change(document.querySelector('.xp-numin input'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar parte 2 de 2' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Copiar texto para la IA' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Copiar parte 2 de 2' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^Parte 2 de 2 · página 2/);
    expect(writeText.mock.calls[0][0]).toContain('[PERSONA_1] firmó');

    await user.click(screen.getByRole('button', { name: /Descargar \(2 partes y diccionario\)/ }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toMatch(new RegExp(`^caso-${CODE}\\.zip$`));
    expect(document.querySelector('.dl-receipt').textContent).toContain('carpeta NO-SUBIR');
  }, 20000);

  it('Restaurar acepta el .zip de un expediente en partes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Recuperar los nombres reales/ }));
    const input = document.querySelector('input[type="file"][accept*=".zip"]');
    fireEvent.change(input, { target: { files: [new File([await partsZip()], 'caso-7F3K.zip')] } });
    await waitFor(() => expect(document.body.textContent).toContain('1 etiquetas'));
    fireEvent.change(screen.getByPlaceholderText(/Pega aquí la respuesta/), { target: { value: 'Según [PERSONA_1], todo bien.' } });
    await waitFor(() => expect(document.querySelector('.restored').textContent).toContain('Según Carlos Andrés Mendoza Ríos, todo bien.'));
  }, 15000);
});

describe('PDF con diseño original (T11)', () => {
  const PASSWORD = 'minoscreto-prueba';
  const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const LINE = 'Demandante: Ana María Pérez Gómez, cédula 1.047.123.456, vecina de Cartagena, presentó la demanda.';
  let runtime;
  beforeAll(async () => { runtime = await createPdfRuntime({ prefer: 'wasm' }); }, 30000);

  // Cliente como el del cargador, sobre PDFium en el mismo proceso; `fault` hace fallar un método.
  function useEngine({ fault = {} } = {}) {
    const pdfium = createPdfium(runtime);
    const run = (name, fn) => async (...args) => { if (fault[name]) throw fault[name]; return fn(...args); };
    const client = {
      open: run('open', (bytes, password) => pdfium.open(new Uint8Array(bytes), password)),
      pageStats: run('pageStats', (p) => pdfium.pageStats(p)),
      editPage: run('editPage', (p, options) => pdfium.editPage(p, options)),
      save: run('save', () => pdfium.save()),
      close: run('close', () => pdfium.close()),
      alive: true
    };
    engine.load = async () => client;
  }

  async function makePdf(pages) {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const png = await doc.embedPng(PNG_1PX);
    for (const draw of pages) draw({ page: doc.addPage([595, 842]), font, png });
    return doc.save({ useObjectStreams: false });
  }
  const textPage = ({ page, font }) => { for (let i = 0; i < 6; i++) page.drawText(LINE, { x: 40, y: 760 - i * 20, size: 10, font }); };
  const scanPage = ({ page, png }) => page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  const pdfOf = async (...pages) => new File([await makePdf(pages)], 'caso.pdf');
  const fixtureFile = (name) => new File([readFileSync(`tests/fixtures/${name}`)], 'caso.pdf');
  const reduceBox = () => document.querySelector('.xp-reduce input');

  // Carga el PDF en Expediente y responde la contraseña de lectura si la pide («Reducir tamaño» queda como viene).
  async function load(user, file, { password } = {}) {
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'), { target: { files: [file] } });
    if (password) {
      await waitFor(() => expect(document.querySelector('dialog').hasAttribute('open')).toBe(true), { timeout: 8000 });
      await user.type(document.querySelector('dialog input'), `${password}{Enter}`);
    }
    await waitFor(() => expect(document.querySelector('.xp-pre')).toBeTruthy(), { timeout: 8000 });
    const ack = screen.queryByLabelText(/Entiendo, continuar/);
    if (ack) await user.click(ack);
  }
  const descargar = (user) => user.click(screen.getByRole('button', { name: 'Descargar' }));
  const receipt = () => document.querySelector('.dl-receipt')?.textContent ?? '';
  const pairDone = () => waitFor(() => expect(downloads).toHaveLength(2), { timeout: DICTIONARY_DELAY + 8000 });
  const fallback = () => document.querySelector('.dl-fallback')?.textContent ?? null;
  const pdfName = () => expect(downloads[0]).toMatch(new RegExp(`^documento-${CODE}_protegido\\.pdf$`));
  const captureBlobs = () => { const blobs = []; URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:prueba'; }); return blobs; };
  const pdfTextOf = async (blob) => {
    const { readPdfPages } = await import('../src/model/expediente/pdfjs.js');
    const pages = await readPdfPages(new Uint8Array(await blob.arrayBuffer()));
    return pages.flatMap((p) => p.lines.map((l) => (typeof l === 'string' ? l : l.text ?? ''))).join(' ');
  };

  it('texto: «Preparando» enseguida en la región aria-live, luego el PDF con diseño sin el dato real', async () => {
    const user = userEvent.setup();
    useEngine();
    const blobs = captureBlobs();
    await load(user, await pdfOf(textPage));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    // En el mismo tick del clic, antes de cualquier await (R9: < 200 ms).
    const live = document.querySelector('.dl-receipt');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain(LAYOUT_PREPARING);
    expect(live.querySelector('.load-bar')).toBeTruthy();
    await pairDone();
    pdfName();
    expect(receipt()).toContain(LAYOUT_OK);
    expect(document.querySelector('.dl-receipt[aria-live="polite"]').textContent).toContain(LAYOUT_OK); // A1: el mensaje final se anuncia
    expect(document.querySelector('.load-bar')).toBeNull();
    expect(fallback()).toBeNull();
    expect(document.querySelector('.dl-images')).toBeNull();
    const text = await pdfTextOf(blobs[0]);
    expect(text).not.toContain('Ana María Pérez Gómez');
    expect(text).not.toContain('1.047.123.456');
    expect(text).toMatch(/\[PERSONA_1\]/);
    expect(text).toContain('Cartagena');
  }, 40000);

  it('«Reducir tamaño» marcado: un dato que solo sale en el encabezado también va al diccionario del PDF con diseño', async () => {
    const user = userEvent.setup();
    useEngine();
    const blobs = captureBlobs();
    const HEADER = 'Apoderado: Carlos Andrés Ruiz Torres, cédula 73.555.111';
    const withHeader = ({ page, font }) => { page.drawText(HEADER, { x: 40, y: 810, size: 9, font }); textPage({ page, font }); };
    await load(user, await pdfOf(withHeader, withHeader, withHeader));
    expect(reduceBox().checked).toBe(true);
    expect(document.querySelector('.xp-pre').textContent).not.toContain('73.555.111'); // el encabezado salió del texto
    await descargar(user);
    await pairDone();
    expect(receipt()).toContain(LAYOUT_OK);
    expect(await pdfTextOf(blobs[0])).not.toContain('73.555.111');
    const dict = JSON.parse(await blobs[1].text());
    expect(Object.values(dict)).toContain('73.555.111');
  }, 40000);

  it('un segundo clic mientras se prepara no descarga dos veces', async () => {
    const user = userEvent.setup();
    useEngine();
    await load(user, await pdfOf(textPage));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    await pairDone();
    await new Promise((r) => setTimeout(r, DICTIONARY_DELAY + 500));
    expect(downloads).toHaveLength(2);
  }, 40000);

  it('página con imagen y texto: PDF con diseño y aviso de revisar esa página', async () => {
    const user = userEvent.setup();
    useEngine();
    const logo = ({ page, png, font }) => { page.drawImage(png, { x: 40, y: 790, width: 80, height: 40 }); textPage({ page, font }); };
    await load(user, await pdfOf(textPage, logo));
    await descargar(user);
    await pairDone();
    expect(receipt()).toContain(LAYOUT_OK);
    expect(document.querySelector('.dl-images').textContent).toMatch(/1 página tiene imágenes \(página 2\)/);
  }, 40000);

  it('página escaneada → PDF de texto con el aviso que nombra la página', async () => {
    const user = userEvent.setup();
    useEngine();
    await load(user, await pdfOf(textPage, scanPage));
    await descargar(user);
    await pairDone();
    pdfName();
    expect(receipt()).not.toContain(LAYOUT_OK);
    expect(fallback()).toBe(LAYOUT_FALLBACK.scan([2]));
    // A1: el aviso de la copia de texto está dentro de la región aria-live
    expect(document.querySelector('.dl-receipt[aria-live="polite"]').textContent).toContain(LAYOUT_FALLBACK.scan([2]));
  }, 40000);

  it('dato partido entre dos líneas → el motor lo cambia: PDF con diseño y sin aviso (T12b)', async () => {
    const user = userEvent.setup();
    useEngine();
    await load(user, fixtureFile('valor_partido_sintetico.pdf'));
    await descargar(user);
    await pairDone();
    pdfName();
    expect(receipt()).toContain(LAYOUT_OK);
    expect(fallback()).toBeNull();
  }, 40000);

  it('dato partido entre dos páginas → el motor borra los dos trozos: PDF con diseño y sin aviso (T12c)', async () => {
    const user = userEvent.setup();
    useEngine();
    await load(user, fixtureFile('valor_entre_folios_sintetico.pdf'));
    await descargar(user);
    await pairDone();
    pdfName();
    expect(receipt()).toContain(LAYOUT_OK);
    expect(fallback()).toBeNull();
  }, 40000);

  it('dato partido entre tres páginas → PDF de texto con el aviso missed-value', async () => {
    const user = userEvent.setup();
    useEngine();
    await load(user, fixtureFile('valor_tres_folios_sintetico.pdf'));
    await descargar(user);
    await pairDone();
    pdfName();
    expect(fallback()).toBe(LAYOUT_FALLBACK['missed-value']);
  }, 40000);

  it('el motor no carga (sin build) → PDF de texto con el aviso engine', async () => {
    const user = userEvent.setup();
    await load(user, await pdfOf(textPage));
    await descargar(user);
    await pairDone();
    pdfName();
    expect(fallback()).toBe(LAYOUT_FALLBACK.engine);
  }, 40000);

  it('archivo demasiado grande para el motor → aviso too-large', async () => {
    const user = userEvent.setup();
    useEngine({ fault: { open: Object.assign(new Error('grande'), { code: 'too-large' }) } });
    await load(user, await pdfOf(textPage));
    await descargar(user);
    await pairDone();
    expect(fallback()).toBe(LAYOUT_FALLBACK['too-large']);
  }, 40000);

  it('fallo inesperado del motor → aviso error', async () => {
    const user = userEvent.setup();
    useEngine({ fault: { pageStats: new Error('roto') } });
    await load(user, await pdfOf(textPage));
    await descargar(user);
    await pairDone();
    expect(fallback()).toBe(LAYOUT_FALLBACK.error);
  }, 40000);

  it('«Reducir tamaño» desmarcado tampoco cambia el PDF: sale con su diseño original', async () => {
    const user = userEvent.setup();
    useEngine();
    await load(user, await pdfOf(textPage));
    expect(reduceBox().checked).toBe(true);
    await user.click(reduceBox());
    expect(reduceBox().checked).toBe(false);
    // Desmarcar vuelve a anonimizar el texto; «Descargar» espera a que termine.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar' }).disabled).toBe(false), { timeout: 8000 });
    await descargar(user);
    await pairDone();
    pdfName();
    expect(fallback()).toBeNull();
    expect(receipt()).toContain(LAYOUT_OK);
  }, 40000);

  it('«Solo marcados» da el PDF de texto sin aviso y sin cargar el motor', async () => {
    const user = userEvent.setup();
    useEngine();
    const loadSpy = vi.spyOn(engine, 'load');
    await load(user, await pdfOf(textPage));
    await user.type(screen.getByLabelText('Buscar en todo el expediente'), 'Cartagena');
    const mark = await screen.findAllByLabelText(/^Marcar pasaje/, {}, { timeout: 4000 });
    await user.click(mark[0]);
    await user.click(screen.getByRole('button', { name: /Solo marcados \(1\)/ }));
    await descargar(user);
    await pairDone();
    pdfName();
    expect(fallback()).toBeNull();
    expect(receipt()).not.toContain(LAYOUT_OK);
    expect(loadSpy).not.toHaveBeenCalled();
  }, 40000);

  describe('PDF con contraseña: se pide una sola vez (ADR-009)', () => {
    const dialogOpen = () => document.querySelector('dialog').hasAttribute('open');

    it('la contraseña escrita al cargar basta: el PDF con diseño sale sin una segunda pregunta', async () => {
      const user = userEvent.setup();
      useEngine();
      await load(user, fixtureFile('contrasena_usuario_sintetico.pdf'), { password: PASSWORD });
      await waitFor(() => expect(dialogOpen()).toBe(false));
      await descargar(user);
      await pairDone();
      expect(dialogOpen()).toBe(false);
      expect(document.querySelector('dialog').textContent).not.toContain('Escríbala otra vez');
      expect(fallback()).toBeNull();
      expect(receipt()).toContain(LAYOUT_OK);
    }, 40000);
  });

  describe('PDF con contraseña: si no se pudo quitar al cargar, se pide otra vez (ADR-007, respaldo)', () => {
    const dialogOpen = () => document.querySelector('dialog').hasAttribute('open');
    // El motor falla solo en la primera carga (la del desbloqueo al cargar); después funciona.
    const startLayout = async (user) => {
      useEngine();
      const working = engine.load;
      let first = true;
      engine.load = async (...args) => { if (first) { first = false; throw new Error('sin motor al cargar'); } return working(...args); };
      await load(user, fixtureFile('contrasena_usuario_sintetico.pdf'), { password: PASSWORD });
      await waitFor(() => expect(dialogOpen()).toBe(false));
      await descargar(user);
      await waitFor(() => expect(dialogOpen()).toBe(true), { timeout: 8000 });
      expect(document.querySelector('dialog').textContent).toContain('Escríbala otra vez');
    };

    it('la contraseña correcta da el PDF con diseño y cierra el diálogo', async () => {
      const user = userEvent.setup();
      await startLayout(user);
      await user.type(document.querySelector('dialog input'), `${PASSWORD}{Enter}`);
      await pairDone();
      expect(dialogOpen()).toBe(false);
      expect(fallback()).toBeNull();
      expect(receipt()).toContain(LAYOUT_OK);
    }, 40000);

    it('una contraseña equivocada la pide de nuevo como incorrecta', async () => {
      const user = userEvent.setup();
      await startLayout(user);
      await user.type(document.querySelector('dialog input'), 'otra{Enter}');
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Contraseña incorrecta'), { timeout: 8000 });
      expect(dialogOpen()).toBe(true);
      expect(downloads).toHaveLength(0);
      await user.clear(document.querySelector('dialog input'));
      await user.type(document.querySelector('dialog input'), `${PASSWORD}{Enter}`);
      await pairDone();
      expect(receipt()).toContain(LAYOUT_OK);
    }, 40000);

    it('Cancelar da el PDF de texto con el aviso password-cancel y deja el expediente abierto', async () => {
      const user = userEvent.setup();
      await startLayout(user);
      await user.click(within(document.querySelector('dialog')).getByRole('button', { name: 'Cancelar' }));
      await pairDone();
      pdfName();
      expect(fallback()).toBe(LAYOUT_FALLBACK['password-cancel']);
      expect(document.querySelector('.xp-pre')).toBeTruthy();
    }, 40000);
  });
});
