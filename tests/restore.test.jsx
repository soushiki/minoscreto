import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import App from '../src/App.jsx';
import { buildDocx, openDocx } from '../src/model/index.js';
import { RESTORE_FALLBACK, RESTORE_LAYOUT_OK, RESTORE_PREPARING } from '../src/viewmodels/messages.js';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { createPdfium } from '../src/engine-worker/pdfium.js';

// pdf.js sin worker real: el mismo montaje que tests/expediente.test.js
// slowFirstDestroy: la primera lectura tarda en fallar tras abortarla, como un pdf.js ocupado (carrera con la lectura nueva).
const slow = vi.hoisted(() => ({ on: false }));
vi.mock('pdfjs-dist', async () => {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return {
    ...lib,
    GlobalWorkerOptions: {},
    getDocument: (...args) => {
      const task = lib.getDocument(...args);
      if (slow.on) {
        slow.on = false;
        const original = task.promise;
        const delayed = original.then((v) => v, (e) => new Promise((_, reject) => { setTimeout(() => reject(e), 400); }));
        Object.defineProperty(task, 'promise', { get: () => delayed });
      }
      return task;
    }
  };
});
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));
// FIX-5: cuenta cuántas veces se escribe un PDF (el real, envuelto).
const writes = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/model/pdf/writer.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, writeTextPdf: (...args) => { writes.count += 1; return real.writeTextPdf(...args); } };
});

// T14: el motor del PDF con diseño. Sin `engine.load` el cargador real falla (ENGINE es null fuera del build) →
// PDF restaurado de texto con el aviso «engine». Con `engine.load`, PDFium real en el mismo proceso.
const engine = vi.hoisted(() => ({ load: null }));
vi.mock('../src/model/engine/loader.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadEngine: (...args) => (engine.load ? engine.load(...args) : actual.loadEngine(...args)) };
});

const DICT = {
  '[PERSONA_1]': 'Ana Gómez', '[PERSONA_2]': 'Luis Pérez', '[EMPRESA_1]': 'Acme SAS',
  '[DIRECCION_1]': 'Calle 1 # 2-3', '[CEDULA_1]': '123', '[TELEFONO_1]': '300'
};
const RIGHT = 'minoscreto-prueba';
let saved;

const fixture = (name) => new File([readFileSync(`tests/fixtures/${name}.pdf`)], `${name}.pdf`, { type: 'application/pdf' });
const toBytes = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result));
  reader.onerror = reject;
  reader.readAsArrayBuffer(blob);
});
async function textOf(blob) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: await toBytes(blob), verbosity: 0 }).promise;
  let out = '';
  for (let n = 1; n <= pdf.numPages; n++) out += (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
  return out;
}

// Diccionario sin «_diccionario» en el nombre: el restaurado conserva el nombre del archivo subido (FIX-10).
async function loadDictionary(dict, dictName = 'llave.json') {
  const input = document.querySelector('input[type="file"][accept*=".zip"]');
  fireEvent.change(input, { target: { files: [new File([JSON.stringify(dict)], dictName)] } });
  await waitFor(() => expect(document.body.textContent).toContain(`${Object.keys(dict).length} etiquetas`));
}
async function openRestore(user, dict = DICT, dictName = 'llave.json') {
  render(<App />);
  await user.click(screen.getByRole('button', { name: /Recuperar los nombres reales/ }));
  if (dict) await loadDictionary(dict, dictName);
  await user.click(screen.getByRole('button', { name: 'Archivo' }));
}
const fileInput = () => document.querySelector('input[type="file"][accept*=".pdf"]');
const upload = (file) => fireEvent.change(fileInput(), { target: { files: [file] } });
const downloadButton = () => screen.findByRole('button', { name: /Descargar .* restaurado/ });
const openDialog = () => document.querySelector('dialog.pw-dialog[open]');

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
afterEach(() => { engine.load = null; cleanup(); vi.restoreAllMocks(); });

describe('Restaurar: pestaña Archivo con .pdf (T10: R3, R5)', () => {
  it('la pestaña «Word» ahora se llama «Archivo» y acepta .docx y .pdf', async () => {
    await openRestore(userEvent.setup(), null);
    expect(screen.queryByRole('button', { name: /Subir Word/ })).toBeNull();
    expect(fileInput().getAttribute('accept')).toContain('.docx');
    expect(screen.getByRole('button', { name: /Elegir archivo \(\.docx o \.pdf\)/ })).toBeTruthy();
  });

  it.each([
    ['etiquetas_fin_de_linea_sintetico', ['Acme SAS', 'Luis Pérez', 'Calle 1 # 2-3']],
    ['chrome_guardar_como_sintetico', ['Calle 1 # 2-3']]
  ])('restaura %s a los valores originales y guarda <nombre>-restaurado.pdf', async (name, values) => {
    const user = userEvent.setup();
    await openRestore(user);
    upload(fixture(name));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe(`${name}-restaurado.pdf`);
    const text = await textOf(saved[0].blob);
    for (const v of values) expect(text).toContain(v);
    expect(text).not.toMatch(/\[(PERSONA|EMPRESA|DIRECCION|CEDULA|TELEFONO)_/);
  }, 20000);

  it('lista los fragmentos que no pudo unir junto con las etiquetas sin entrada', async () => {
    const user = userEvent.setup();
    const partial = { ...DICT };
    delete partial['[PERSONA_2]'];
    await openRestore(user, partial);
    upload(fixture('etiquetas_fin_de_linea_sintetico'));
    await waitFor(() => expect(document.body.textContent).toContain('Sin entrada en el diccionario'));
    expect(document.querySelector('.note').textContent).toMatch(/\[PERSONA_/);
  }, 20000);

  it('PDF con contraseña: pregunta en el diálogo, restaura con la correcta y cierra el diálogo', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    upload(fixture('contrasena_usuario_sintetico'));
    await waitFor(() => expect(openDialog()).toBeTruthy());
    await user.type(openDialog().querySelector('input'), `${RIGHT}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF restaurado' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('contrasena_usuario_sintetico-restaurado.pdf');
    expect(openDialog()).toBeNull();
  }, 20000);

  it('un segundo PDF mientras el primero espera contraseña: el diálogo sigue abierto para el segundo y restaura', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    slow.on = true;
    upload(fixture('contrasena_usuario_sintetico'));
    await waitFor(() => expect(openDialog()).toBeTruthy());
    const second = new File([readFileSync('tests/fixtures/contrasena_usuario_sintetico.pdf')], 'segundo.pdf', { type: 'application/pdf' });
    upload(second);
    await waitFor(() => expect(openDialog()?.textContent).toContain('segundo.pdf'));
    await new Promise((r) => setTimeout(r, 700)); // deja correr el finally de la lectura vieja
    expect(openDialog()?.textContent).toContain('segundo.pdf');
    await user.type(openDialog().querySelector('input'), `${RIGHT}{Enter}`);
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('segundo-restaurado.pdf');
  }, 20000);

  it('Cancelar la contraseña aborta la lectura: sin resultado, sin aviso de error y sin diálogo', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    upload(fixture('contrasena_usuario_sintetico'));
    await waitFor(() => expect(openDialog()).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(screen.queryByRole('button', { name: /Descargar .* restaurado/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/No se pudo procesar|No se abrió/);
  }, 20000);

  it('FIX-1: un archivo nuevo oculta el resultado anterior hasta terminar de leerse', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    upload(new File([await buildDocx(['Según [PERSONA_1].'])], 'A.docx'));
    await screen.findByRole('button', { name: 'Descargar Word restaurado' });
    upload(fixture('contrasena_usuario_sintetico')); // se queda esperando la contraseña: lectura "lenta"
    await waitFor(() => expect(openDialog()).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Descargar .* restaurado/ })).toBeNull();
    await user.type(openDialog().querySelector('input'), `${RIGHT}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF restaurado' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('contrasena_usuario_sintetico-restaurado.pdf');
    expect(saved[0].blob.type).toBe('application/pdf');
  }, 20000);

  it('FIX-10: con nuestro diccionario, el restaurado lleva el nombre real (el archivo de la IA tiene nombre neutro)', async () => {
    const user = userEvent.setup();
    await openRestore(user, DICT, 'Tutela Juan Pérez_diccionario-7F3K.json');
    upload(new File([readFileSync('tests/fixtures/etiquetas_fin_de_linea_sintetico.pdf')], 'documento-7F3K_protegido.pdf', { type: 'application/pdf' }));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('Tutela Juan Pérez-restaurado.pdf');
  }, 20000);

  it('con el .zip del expediente en partes como diccionario, el restaurado también lleva el nombre real', async () => {
    const user = userEvent.setup();
    await openRestore(user, null);
    const zip = new JSZip();
    zip.file('Tutela Juan Pérez_diccionario-7F3K.json', JSON.stringify(DICT));
    zip.file('para-subir-a-la-IA/documento-7F3K_parte-01-de-02.pdf', 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    fireEvent.change(document.querySelector('input[type="file"][accept*=".zip"]'), { target: { files: [new File([bytes], 'Tutela Juan Pérez-7F3K.zip')] } });
    await waitFor(() => expect(document.body.textContent).toContain(`${Object.keys(DICT).length} etiquetas`));
    await user.click(screen.getByRole('button', { name: 'Archivo' }));
    upload(new File([readFileSync('tests/fixtures/etiquetas_fin_de_linea_sintetico.pdf')], 'documento-7F3K_parte-01-de-02.pdf', { type: 'application/pdf' }));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('Tutela Juan Pérez-restaurado.pdf');
  }, 20000);

  it('FIX-4: cambiar de diccionario no vuelve a pedir la contraseña y usa los valores nuevos', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    upload(fixture('contrasena_usuario_sintetico'));
    await waitFor(() => expect(openDialog()).toBeTruthy());
    await user.type(openDialog().querySelector('input'), `${RIGHT}{Enter}`);
    await downloadButton();
    expect(document.body.textContent).not.toContain('[PERSONA_77]');
    await loadDictionary({ '[PERSONA_77]': 'Nadie' }, 'otro_diccionario-7F3K.json');
    // El resultado ya es el del diccionario nuevo (la etiqueta nueva no aparece en el documento) y sin volver a preguntar.
    await waitFor(() => expect(document.body.textContent).toMatch(/No aparecen en el documento: \[PERSONA_77\]/));
    await new Promise((r) => setTimeout(r, 500));
    expect(openDialog()).toBeNull();
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('otro-restaurado.pdf');
  }, 20000);

  it('FIX-5: el PDF restaurado se escribe al descargarlo, no al restaurar ni al cambiar de diccionario', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    writes.count = 0;
    upload(fixture('etiquetas_fin_de_linea_sintetico'));
    await downloadButton();
    await loadDictionary({ ...DICT, '[EMPRESA_1]': 'Beta Ltda', '[PERSONA_9]': 'Nadie' });
    await downloadButton();
    expect(writes.count).toBe(0);
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(writes.count).toBe(1);
    const text = await textOf(saved[0].blob); // escrito con el diccionario vigente
    expect(text).toContain('Beta Ltda');
    expect(text).not.toContain('Acme SAS');
  }, 20000);

  it('los caracteres que el PDF no puede escribir se avisan al descargar', async () => {
    const user = userEvent.setup();
    await openRestore(user, { ...DICT, '[EMPRESA_1]': 'Acme 😀 SAS' });
    upload(fixture('etiquetas_fin_de_linea_sintetico'));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    await waitFor(() => expect(document.body.textContent).toMatch(/se omitieron/));
  }, 20000);

  it('FIX-6: un PDF del formato anterior («como [PERSONA_1] o [EMPRESA_2]») no restaura los ejemplos de la nota', async () => {
    const { writeTextPdf } = await import('../src/model/pdf/writer.js');
    const old = ['# Caso (anonimizado)', '', 'Expediente completo · folio 1', '',
      'Los datos personales se reemplazaron por etiquetas entre corchetes, como [PERSONA_1] o [EMPRESA_2]. '
      + 'Son las mismas en todas las partes: úsalas tal cual en tus respuestas, sin intentar adivinar los datos reales.', '',
      '[Folio 1]', '', 'Respondió [PERSONA_2] el lunes.'];
    const { bytes } = await writeTextPdf({ lines: old });
    const user = userEvent.setup();
    await openRestore(user, { ...DICT, '[EMPRESA_2]': 'Beta Ltda' });
    upload(new File([bytes], 'viejo.pdf', { type: 'application/pdf' }));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    const text = await textOf(saved[0].blob);
    expect(text).toContain('Respondió Luis Pérez el lunes.');
    expect(text).not.toMatch(/Ana Gómez|Beta Ltda|etiquetas entre corchetes|anonimizado/);
  }, 20000);

  it('un archivo que no es .docx ni .pdf se rechaza', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    upload(new File(['x'], 'nota.txt'));
    await waitFor(() => expect(document.body.textContent).toContain('Sube un Word (.docx) o un PDF.'));
  });

  it('.docx sigue restaurándose igual y se guarda como .docx', async () => {
    const user = userEvent.setup();
    await openRestore(user);
    const buffer = await buildDocx(['Según [PERSONA_1] y [EMPRESA_1].']);
    upload(new File([buffer], 'resp.docx'));
    await user.click(await screen.findByRole('button', { name: 'Descargar Word restaurado' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('resp-restaurado.docx');
    const doc = await openDocx(await toBytes(saved[0].blob));
    expect(doc.paragraphs.map((p) => p.text).join('\n')).toContain('Según Ana Gómez y Acme SAS.');
  }, 20000);
});

describe('PDF restaurado con diseño (T14)', () => {
  const AI_DICT = JSON.parse(readFileSync('tests/fixtures/respuesta_ia_sintetico.json', 'utf8'));
  const AI_VALUES = ['Ana María Pérez Gómez', 'Pedro Núñez Castaño', 'Construcciones Bahía S.A.S.'];
  const TAG = /\[(PERSONA|EMPRESA|DIRECCION|CEDULA|TELEFONO|NIT)_\d\]/;
  const PASSWORD = 'minoscreto-prueba';
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
  const status = () => document.querySelector('.rs-status');
  const collapse = (text) => text.replace(/\s+/g, ' ');
  const aiPdf = () => fixture('respuesta_ia_sintetico');

  it('muestra «Preparando» al instante en la región aria-live, guarda el PDF con diseño y no escribe el de texto', async () => {
    const user = userEvent.setup();
    useEngine();
    await openRestore(user, AI_DICT);
    upload(aiPdf());
    const button = await downloadButton();
    writes.count = 0;
    fireEvent.click(button);
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe(RESTORE_PREPARING); // en el mismo tick del clic
    expect(document.querySelector('.load-bar')).toBeTruthy();
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
    expect(saved[0].name).toBe('respuesta_ia_sintetico-restaurado.pdf');
    const text = collapse(await textOf(saved[0].blob));
    for (const v of AI_VALUES) expect(text).toContain(v);
    expect(text).not.toMatch(TAG);
    await waitFor(() => expect(status().textContent).toBe(RESTORE_LAYOUT_OK));
    expect(document.querySelector('.load-bar')).toBeNull();
    expect(status().classList.contains('rs-fallback')).toBe(false);
    expect(writes.count).toBe(0);
  }, 40000);

  it('una etiqueta que no se pudo cambiar: PDF de texto con los valores reales y el aviso missed-value', async () => {
    const user = userEvent.setup();
    useEngine();
    await openRestore(user);
    upload(fixture('etiquetas_fin_de_linea_sintetico'));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
    expect(saved[0].name).toBe('etiquetas_fin_de_linea_sintetico-restaurado.pdf');
    const text = await textOf(saved[0].blob);
    expect(text).toContain('Acme SAS');
    expect(text).not.toMatch(TAG);
    await waitFor(() => expect(status().textContent).toBe(RESTORE_FALLBACK['missed-value']));
    expect(document.querySelector('.load-bar')).toBeNull();
    expect(document.querySelector('.rs-status[aria-live="polite"]').textContent).toBe(RESTORE_FALLBACK['missed-value']); // A1
    expect(status().classList.contains('rs-fallback')).toBe(true);
  }, 40000);

  it('el motor no carga: PDF restaurado de texto y el aviso engine, sin preguntar nada', async () => {
    const user = userEvent.setup();
    await openRestore(user, AI_DICT);
    upload(aiPdf());
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(collapse(await textOf(saved[0].blob))).toContain('Ana María Pérez Gómez');
    await waitFor(() => expect(status().textContent).toBe(RESTORE_FALLBACK.engine));
    expect(openDialog()).toBeNull();
  }, 20000);

  it('el motor falla al abrir el PDF: un solo PDF de texto y el aviso engine', async () => {
    const user = userEvent.setup();
    useEngine({ fault: { open: Object.assign(new Error('boom'), { code: 'font' }) } });
    await openRestore(user, AI_DICT);
    upload(aiPdf());
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
    await waitFor(() => expect(status().textContent).toBe(RESTORE_FALLBACK.engine));
    expect(collapse(await textOf(saved[0].blob))).toContain('Pedro Núñez Castaño');
  }, 40000);

  it('con el .zip de un expediente como diccionario también sale con diseño y con el nombre real (FIX-10)', async () => {
    const user = userEvent.setup();
    useEngine();
    await openRestore(user, null);
    const zip = new JSZip();
    zip.file('Tutela Juan Pérez_diccionario-7F3K.json', JSON.stringify(AI_DICT));
    zip.file('para-subir-a-la-IA/documento-7F3K_parte-01-de-01.pdf', 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    fireEvent.change(document.querySelector('input[type="file"][accept*=".zip"]'), { target: { files: [new File([bytes], 'Tutela Juan Pérez-7F3K.zip')] } });
    await waitFor(() => expect(document.body.textContent).toContain(`${Object.keys(AI_DICT).length} etiquetas`));
    await user.click(screen.getByRole('button', { name: 'Archivo' }));
    upload(new File([readFileSync('tests/fixtures/respuesta_ia_sintetico.pdf')], 'documento-7F3K_parte-01-de-01.pdf', { type: 'application/pdf' }));
    await user.click(await downloadButton());
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
    expect(saved[0].name).toBe('Tutela Juan Pérez-restaurado.pdf');
    await waitFor(() => expect(status().textContent).toBe(RESTORE_LAYOUT_OK));
    expect(collapse(await textOf(saved[0].blob))).toContain('Ana María Pérez Gómez');
  }, 40000);

  describe('PDF con contraseña: se pide otra vez (ADR-007)', () => {
    const askAgain = async (user) => {
      useEngine();
      await openRestore(user);
      upload(fixture('contrasena_usuario_sintetico'));
      await waitFor(() => expect(openDialog()).toBeTruthy());
      await user.type(openDialog().querySelector('input'), `${PASSWORD}{Enter}`);
      await user.click(await downloadButton());
      await waitFor(() => expect(openDialog()?.textContent).toContain('Escríbala otra vez'), { timeout: 8000 });
    };

    it('la contraseña correcta da el PDF con diseño y cierra el diálogo', async () => {
      const user = userEvent.setup();
      await askAgain(user);
      await user.type(openDialog().querySelector('input'), `${PASSWORD}{Enter}`);
      await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
      expect(saved[0].name).toBe('contrasena_usuario_sintetico-restaurado.pdf');
      await waitFor(() => expect(status().textContent).toBe(RESTORE_LAYOUT_OK));
      expect(openDialog()).toBeNull();
      expect(await textOf(saved[0].blob)).not.toMatch(TAG);
    }, 40000);

    it('Cancelar da el PDF restaurado de texto con el aviso password-cancel', async () => {
      const user = userEvent.setup();
      await askAgain(user);
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
      await waitFor(() => expect(status().textContent).toBe(RESTORE_FALLBACK['password-cancel']));
      expect(openDialog()).toBeNull();
    }, 40000);
  });

  it('un segundo clic mientras se prepara no guarda dos veces', async () => {
    const user = userEvent.setup();
    useEngine();
    await openRestore(user, AI_DICT);
    upload(aiPdf());
    const button = await downloadButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));
    expect(saved).toHaveLength(1);
  }, 40000);

  it('cambiar de diccionario mientras se prepara: no se guarda nada y el aviso se borra', async () => {
    const user = userEvent.setup();
    useEngine();
    await openRestore(user, AI_DICT);
    upload(aiPdf());
    fireEvent.click(await downloadButton());
    expect(status().textContent).toBe(RESTORE_PREPARING);
    await loadDictionary({ '[PERSONA_1]': 'Otra Persona' }, 'otro.json');
    await waitFor(() => expect(status().textContent).toBe(''));
    await new Promise((r) => setTimeout(r, 1500));
    expect(saved).toHaveLength(0);
    expect(status().textContent).toBe('');
  }, 40000);
});
