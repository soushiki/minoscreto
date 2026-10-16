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

  it('documento largo: en partes por defecto, «un solo archivo» abre Expediente con esa opción y no se guarda para la próxima vez', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    await user.click(screen.getByRole('button', { name: /^Largo/ }));
    expect(heading()).toBe('Documentos largos');
    expect(screen.getByRole('radio', { name: /En partes para la IA/ }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: /Un solo archivo/ }));
    expect(screen.getByRole('radio', { name: /Un solo archivo/ }).getAttribute('aria-checked')).toBe('true');

    await chooseFile(await wordFile(['La señora Laura Patricia Ortega Jiménez demandó.', 'Laura Patricia Ortega Jiménez firmó.'], 'expediente.docx'));
    await waitFor(() => expect(document.querySelector('.xp-pre')?.textContent || '').toContain('[PERSONA_1] firmó'), { timeout: 8000 });
    expect(document.querySelector('.tab.on').textContent).toBe('Expediente');
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar texto para la IA' })).toBeTruthy();
    cleanup();

    // Otro documento empieza desde cero: nada recordado.
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    expect(document.querySelector('.wl-tag')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Largo/ }));
    expect(screen.getByRole('radio', { name: /En partes para la IA/ }).getAttribute('aria-checked')).toBe('true');
    expect(window.localStorage.length).toBe(0);
  });

  it('«Ir directo a las herramientas» va a las herramientas solo esa vez; al volver a abrir, aparece la bienvenida', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Ir directo a las herramientas' }));
    expect(document.querySelector('.tab.on').textContent).toBe('Anonimizar');
    await user.click(screen.getByRole('button', { name: /volver al inicio/ }));
    expect(heading()).toBe('Bienvenido a Minoscreto');
    await user.click(screen.getByRole('button', { name: 'Ir directo a las herramientas' }));
    cleanup();

    render(<App />);
    expect(heading()).toBe('Bienvenido a Minoscreto');
  });

  it('la bienvenida muestra solo el logo y las dos opciones; el menú aparece en las herramientas y el logo vuelve al inicio', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(document.querySelector('.tabs')).toBeNull();
    expect(document.querySelector('.priv')).toBeNull();
    expect(document.querySelectorAll('.wl-choice')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Proteger un documento/ }));
    expect(document.querySelector('.tabs')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Corto/ }));
    await user.click(screen.getByRole('button', { name: 'Ver primero un ejemplo' }));
    expect(document.querySelector('.tab.on').textContent).toBe('Anonimizar');
    await user.click(screen.getByRole('button', { name: /volver al inicio/ }));
    expect(heading()).toBe('Bienvenido a Minoscreto');
    expect(document.querySelector('.tabs')).toBeNull();
  });
});
