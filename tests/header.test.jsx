import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import Header from '../src/views/Header.jsx';

const anonymizer = { replacements: 0, canUndo: false, canRedo: false, actions: {} };
const topH = () => document.documentElement.style.getPropertyValue('--top-h');
const setup = (position) => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 88 });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ position });
  render(<Header screen="welcome" onScreen={() => {}} onHome={() => {}} anonymizer={anonymizer} />);
};

beforeEach(() => { document.documentElement.style.removeProperty('--top-h'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete HTMLElement.prototype.offsetHeight; });

describe('cabecera: --top-h', () => {
  it('con la cabecera sticky mide su alto', () => {
    setup('sticky');
    expect(topH()).toBe('88px');
  });

  it('con la cabecera estática (ventana baja) vale 0px, también tras cambiar el tamaño', () => {
    setup('static');
    expect(topH()).toBe('0px');
    window.getComputedStyle.mockReturnValue({ position: 'sticky' });
    window.dispatchEvent(new Event('resize'));
    expect(topH()).toBe('88px');
  });
});
