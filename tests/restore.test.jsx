import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import App from '../src/App.jsx';
import { buildDocx, openDocx } from '../src/model/index.js';

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
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
