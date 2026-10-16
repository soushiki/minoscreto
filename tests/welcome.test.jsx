import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { buildDocx } from '../src/model/index.js';

beforeAll(() => {
  window.scrollTo = () => {};
  window.ResizeObserver = window.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});
beforeEach(() => { window.localStorage.clear(); cleanup(); });

const heading = () => document.querySelector('.wl-card h1')?.textContent;
const chooseFile = async (file) => {
  fireEvent.change(document.querySelector('.wl-card input[type="file"]'), { target: { files: [file] } });
};
const wordFile = async (paragraphs, name = 'contrato.docx') => new File([await buildDocx(paragraphs)], name);

describe('bienvenida guiada', () => {
  it('pregunta qué hacer y lleva a Restaurar nombres', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(heading()).toBe('Bienvenido a Minoscreto');
    expect(screen.getByText('¿Qué le gustaría hacer?')).toBeTruthy();
    expect(screen.getByText(/nunca salen de este computador/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Volver/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Recuperar los nombres reales/ }));
    expect(screen.getByPlaceholderText(/Pega aquí la respuesta/)).toBeTruthy();
  });

  it('documento corto: elegir un Word abre la revisión con ese documento; Volver regresa un paso', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    expect(heading()).toBe('¿Qué tan largo es su documento?');
    await user.click(screen.getByRole('button', { name: /Volver/ }));
    expect(heading()).toBe('Bienvenido a Minoscreto');
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    await user.click(screen.getByRole('button', { name: /^Corto/ }));
    expect(heading()).toBe('Elija su documento');
    await chooseFile(await wordFile(['El señor Carlos Andrés Mendoza Ríos firmó el acuerdo.']));
    await waitFor(() => expect(document.body.textContent).toContain('[PERSONA_1] firmó el acuerdo'), { timeout: 8000 });
    expect(document.querySelector('.tab.on').textContent).toBe('Anonimizar');
  });

  it('documento corto: «Ver primero un ejemplo» muestra el contrato de ejemplo', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    await user.click(screen.getByRole('button', { name: /^Corto/ }));
    await user.click(screen.getByRole('button', { name: 'Ver primero un ejemplo' }));
    await waitFor(() => expect(document.body.textContent).toContain('Contrato de ejemplo'), { timeout: 8000 });
  });

  it('documento largo: en partes por defecto, recuerda «un solo archivo» y abre Expediente con esa opción', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    await user.click(screen.getByRole('button', { name: /^Largo/ }));
    expect(heading()).toBe('Documentos largos');
    expect(screen.getByRole('radio', { name: /En partes para la IA/ }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: /Un solo archivo/ }));
    expect(screen.getByRole('radio', { name: /Un solo archivo/ }).getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(window.localStorage.getItem('minoscreto.guia'))).toMatchObject({ length: 'long', output: 'one' });

    await chooseFile(await wordFile(['La señora Laura Patricia Ortega Jiménez demandó.', 'Laura Patricia Ortega Jiménez firmó.'], 'expediente.docx'));
    await waitFor(() => expect(document.querySelector('.xp-pre')?.textContent || '').toContain('[PERSONA_1] firmó'), { timeout: 8000 });
    expect(document.querySelector('.tab.on').textContent).toBe('Expediente');
    expect(screen.getByRole('button', { name: /Descargar \.md/ })).toBeTruthy();
    cleanup();

    // La próxima vez, la guía marca lo que eligió.
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    expect(screen.getByRole('button', { name: /^Largo/ }).textContent).toContain('La última vez');
  });

  it('«Ir directo a las herramientas» se recuerda, y el logo vuelve al inicio', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ir directo a las herramientas' }));
    expect(document.querySelector('.tab.on').textContent).toBe('Anonimizar');
    cleanup();

    render(<App />);
    expect(heading()).toBeUndefined();
    expect(document.querySelector('.tab.on').textContent).toBe('Anonimizar');
    await user.click(screen.getByRole('button', { name: /volver al inicio/ }));
    expect(heading()).toBe('Bienvenido a Minoscreto');
  });
});
