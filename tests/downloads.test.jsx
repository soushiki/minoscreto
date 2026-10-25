import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import App from '../src/App.jsx';
import { goToTools } from './helpers.js';
import {
  buildDocx, buildEntities, buildDictionary, dictionaryFileName, protectedFileName, readDictionaryFrom
} from '../src/model/index.js';
import { buildPartsZip, renderParts, splitParts, anonymizeTexts } from '../src/model/expediente/index.js';
import { DICTIONARY_DELAY } from '../src/viewmodels/useProtectedDownload.js';
import { isAppleTouch } from '../src/viewmodels/platform.js';

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
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
  return buildPartsZip({ name: 'caso', parts: rendered, dictionary: buildDictionary(entities, new Set(applied.usedIds)), type: 'uint8array' });
}

async function wordWithTwoPages() {
  const zip = new JSZip();
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (t, pre = '') => `<w:p><w:r>${pre}<w:t>${t}</w:t></w:r></w:p>`;
  zip.file('word/document.xml', `<w:document ${w}><w:body>${p('La señora Laura Patricia Ortega Jiménez demandó.')}${p('Laura Patricia Ortega Jiménez firmó.', '<w:lastRenderedPageBreak/>')}</w:body></w:document>`);
  return new File([await zip.generateAsync({ type: 'uint8array' })], 'caso.docx');
}

describe('archivos protegidos', () => {
  it('nombra el documento y el diccionario para que queden juntos', () => {
    expect(protectedFileName('Contrato: arriendo', 'docx')).toBe('Contrato- arriendo_protegido.docx');
    expect(dictionaryFileName('Contrato: arriendo')).toBe('Contrato- arriendo_diccionario.json');
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
    await waitFor(() => expect(downloads[0]).toMatch(/_protegido\.docx$/), { timeout: 4000 });
    const base = downloads[0].replace(/_protegido\.docx$/, '');
    expect(document.querySelector('.dl-receipt').textContent).toContain('Guarde el diccionario');
    await waitFor(() => expect(downloads).toEqual([`${base}_protegido.docx`, `${base}_diccionario.json`]), { timeout: DICTIONARY_DELAY + 2000 });
    await waitFor(() => expect(document.querySelectorAll('.dl-mark.ok')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Descargar diccionario de nuevo' }));
    await waitFor(() => expect(downloads).toHaveLength(3));
    expect(downloads[2]).toBe(`${base}_diccionario.json`);

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
      await waitFor(() => expect(downloads[1]).toMatch(/_diccionario\.json$/));
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
    await waitFor(() => expect(downloads).toEqual(['caso_protegido.md', 'caso_diccionario.json']), { timeout: DICTIONARY_DELAY + 3000 });
  }, 20000);

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
    await waitFor(() => expect(downloads).toEqual(['caso_protegido.zip']));
    expect(document.querySelector('.dl-receipt').textContent).toContain('carpeta NO-SUBIR');
  }, 20000);

  it('Restaurar acepta el .zip de un expediente en partes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Recuperar los nombres reales/ }));
    const input = document.querySelector('input[type="file"][accept*=".zip"]');
    fireEvent.change(input, { target: { files: [new File([await partsZip()], 'caso_protegido.zip')] } });
    await waitFor(() => expect(document.body.textContent).toContain('1 etiquetas'));
    fireEvent.change(screen.getByPlaceholderText(/Pega aquí la respuesta/), { target: { value: 'Según [PERSONA_1], todo bien.' } });
    await waitFor(() => expect(document.querySelector('.restored').textContent).toContain('Según Carlos Andrés Mendoza Ríos, todo bien.'));
  }, 15000);
});
