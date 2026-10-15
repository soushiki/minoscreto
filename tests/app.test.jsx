import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';

beforeAll(() => {
  window.scrollTo = () => {};
  window.ResizeObserver = window.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

describe('App', () => {
  it('carga el ejemplo, anonimiza una búsqueda, deshace y abre Restaurar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(document.body.textContent).toContain('[EMPRESA_1]'), { timeout: 8000 });
    expect(document.body.textContent).toContain('[PERSONA_1]');

    const q = screen.getByPlaceholderText('Un nombre, empresa o número');
    await user.type(q, 'Plaza Marina');
    await user.click(await screen.findByRole('button', { name: /^Anonimizar (esta|las \d+)/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/\[DATO_1\]/));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(document.body.textContent).not.toMatch(/\[DATO_1\]/));

    await user.click(screen.getByRole('button', { name: 'Restaurar nombres' }));
    expect(screen.getByPlaceholderText(/Pega aquí la respuesta/)).toBeTruthy();
    cleanup();
  }, 20000);

  it('abre el modo expediente y rechaza archivos que no son PDF', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Expediente PDF' }));
    expect(screen.getByRole('button', { name: 'Elegir PDF' })).toBeTruthy();
    const input = document.querySelector('input[type="file"][accept^=".pdf"]');
    fireEvent.change(input, { target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(document.querySelector('.toast').textContent).toMatch(/recibe PDF/));
    cleanup();
  });
});
