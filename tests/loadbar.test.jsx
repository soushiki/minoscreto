import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LoadBar from '../src/components/LoadBar.jsx';

const bar = (props) => render(<LoadBar {...props} />).container.querySelector('.load-bar');
const fill = (b) => b.querySelector('.load-bar-fill');

describe('LoadBar', () => {
  it('sin total es indeterminada, sin ancho y oculta a los lectores de pantalla', () => {
    const b = bar({});
    expect(b.classList.contains('is-indeterminate')).toBe(true);
    expect(b.classList.contains('is-determinate')).toBe(false);
    expect(b.getAttribute('aria-hidden')).toBe('true');
    expect(fill(b).style.width).toBe('');
  });

  it('3 de 4 es determinada al 75%', () => {
    const b = bar({ done: 3, total: 4 });
    expect(b.classList.contains('is-determinate')).toBe(true);
    expect(fill(b).style.width).toBe('75%');
  });

  it('total 0 es indeterminada', () => {
    const b = bar({ done: 0, total: 0 });
    expect(b.classList.contains('is-indeterminate')).toBe(true);
    expect(fill(b).style.width).toBe('');
  });
});
