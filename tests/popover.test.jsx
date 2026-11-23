import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { goToTools } from './helpers.js';

// T22: ventana «Anonimizar» como popover nativo (con respaldo en div) y valores resaltados operables con el teclado.
// Datos sintéticos: el ejemplo de la guía.
beforeAll(() => {
  window.scrollTo = () => {};
  window.ResizeObserver = window.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const dialog = () => document.querySelector('.pop[role="dialog"][aria-label="Anonimizar"]');
const firstEnt = () => document.querySelector('.cell.orig .ent');

async function open() {
  const user = userEvent.setup();
  render(<App />);
  await goToTools(user);
  await waitFor(() => expect(firstEnt()).toBeTruthy(), { timeout: 8000 });
  return user;
}

describe('ventana Anonimizar: respaldo sin showPopover', () => {
  beforeEach(() => { expect('showPopover' in HTMLElement.prototype).toBe(false); });

  it('los valores resaltados son botones con foco; las palabras sueltas no', async () => {
    await open();
    const ent = firstEnt();
    expect(ent.getAttribute('role')).toBe('button');
    expect(ent.getAttribute('tabindex')).toBe('0');
    expect(ent.getAttribute('aria-haspopup')).toBe('dialog');
    expect(document.querySelector('.cell.orig').hasAttribute('tabindex')).toBe(false);
    expect(document.querySelectorAll('.cell.orig .hit:not(.ent)[tabindex]')).toHaveLength(0);
  });

  it('Enter abre la ventana, el foco entra y Escape la cierra devolviendo el foco al valor', async () => {
    const user = await open();
    const ent = firstEnt();
    ent.focus();
    await user.keyboard('{Enter}');
    expect(dialog()).toBeTruthy();
    expect(dialog().hasAttribute('popover')).toBe(false);
    await waitFor(() => expect(dialog().contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(ent);
  });

  it('Espacio también la abre y se le quita la acción por defecto (no baja la página)', async () => {
    await open();
    const ent = firstEnt();
    ent.focus();
    const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => { ent.dispatchEvent(down); });
    expect(down.defaultPrevented).toBe(true);
    await waitFor(() => expect(dialog()).toBeTruthy());
    await waitFor(() => expect(dialog().contains(document.activeElement)).toBe(true));
  });

  it('otras teclas no abren nada', async () => {
    const user = await open();
    firstEnt().focus();
    await user.keyboard('a');
    expect(dialog()).toBeNull();
  });

  it('con el ratón no se mueve el foco', async () => {
    await open();
    const ent = firstEnt();
    fireEvent.mouseUp(ent);
    await waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog().contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).not.toBe(ent);
  });
});

describe('ventana Anonimizar: popover nativo', () => {
  let showPopover;
  beforeEach(() => {
    showPopover = vi.fn();
    HTMLElement.prototype.showPopover = showPopover;
    HTMLElement.prototype.hidePopover = vi.fn();
  });
  afterEach(() => {
    delete HTMLElement.prototype.showPopover;
    delete HTMLElement.prototype.hidePopover;
  });

  it('lleva popover="auto" y se muestra una vez al abrir', async () => {
    const user = await open();
    firstEnt().focus();
    await user.keyboard('{Enter}');
    expect(dialog().getAttribute('popover')).toBe('auto');
    expect(showPopover).toHaveBeenCalledTimes(1);
  });

  it('el evento toggle «closed» la cierra y devuelve el foco; Escape en el documento no la cierra (lo hace la plataforma)', async () => {
    const user = await open();
    const ent = firstEnt();
    ent.focus();
    await user.keyboard('{Enter}');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(dialog()).toBeTruthy();
    act(() => { dialog().dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' })); });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(ent);
  });
});
