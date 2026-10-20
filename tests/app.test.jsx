import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import App from '../src/App.jsx';
import { goToTools } from './helpers.js';

beforeAll(() => {
  window.scrollTo = () => {};
  window.ResizeObserver = window.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});
beforeEach(() => window.localStorage.clear());

describe('App', () => {
  it('carga el ejemplo, anonimiza una búsqueda, deshace y abre Restaurar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await goToTools(user);
    await waitFor(() => expect(document.body.textContent).toContain('[EMPRESA_1]'), { timeout: 8000 });
    expect(document.body.textContent).toContain('[PERSONA_1]');

    const q = screen.getByPlaceholderText('Un nombre, empresa o número');
    await user.type(q, 'artesanías');
    await user.click(await screen.findByRole('button', { name: /^Anonimizar (esta|las \d+)/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/\[DATO_1\]/));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(document.body.textContent).not.toMatch(/\[DATO_1\]/));

    await user.click(screen.getByRole('button', { name: 'Restaurar nombres' }));
    expect(screen.getByPlaceholderText(/Pega aquí la respuesta/)).toBeTruthy();
    cleanup();
  }, 20000);

  it('abre el modo expediente y rechaza archivos que no son PDF ni Word', async () => {
    const user = userEvent.setup();
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    expect(screen.getByRole('button', { name: 'Elegir archivo' })).toBeTruthy();
    const input = document.querySelector('input[type="file"][accept^=".pdf"]');
    fireEvent.change(input, { target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(document.querySelector('.toast').textContent).toMatch(/recibe PDF o Word/));
    cleanup();
  });

  it('anonimiza un Word en el modo expediente con marcas de página', async () => {
    const user = userEvent.setup();
    render(<App />);
    await goToTools(user);
    await user.click(screen.getByRole('button', { name: 'Expediente' }));
    const zip = new JSZip();
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const p = (t, pre = '') => `<w:p><w:r>${pre}<w:t>${t}</w:t></w:r></w:p>`;
    zip.file('word/document.xml', `<w:document ${w}><w:body>${p('La señora Laura Patricia Ortega Jiménez demandó.')}${p('Laura Patricia Ortega Jiménez firmó.', '<w:lastRenderedPageBreak/>')}</w:body></w:document>`);
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'caso.docx');
    fireEvent.change(document.querySelector('input[type="file"][accept^=".pdf"]'), { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('.xp-pre')?.textContent || '').toContain('[PERSONA_1] firmó'), { timeout: 8000 });
    const preview = document.querySelector('.xp-pre').textContent;
    expect(preview).toContain('[Página 2]');
    expect(preview).not.toContain('Ortega');
    expect(document.querySelector('.xp-summary').textContent).toContain('caso.docx');
    cleanup();
  }, 15000);
});
