import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(header) {
  const i = css.indexOf(header);
  if (i < 0) throw new Error('missing block ' + header);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const vars = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const root = block(':root {');
const darkMedia = block(':root:not([data-theme="light"])');
const darkForced = block(':root[data-theme="dark"]');
function scheme(header) {
  const i = css.indexOf(header);
  const open = css.indexOf('{', i);
  const m = /(?:^|[;{\s])color-scheme:\s*([^;}]+)/.exec(css.slice(open + 1, css.indexOf('}', open)));
  return m ? m[1].trim() : undefined;
}

const TOKENS = ['bg', 'surface', 'surface2', 'ink', 'ink2', 'line', 'line-strong', 'accent', 'accent-ink', 'accent-soft',
  'mark', 'mark-ink', 'cur', 'warn-bg', 'warn-ink', 'warn-line', 'cur-line', 'bad-ink', 'bad'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const light = {};
const dark = {};
for (const t of TOKENS) {
  const m = /^light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)$/.exec(root[t] ?? '');
  if (m) { light[t] = m[1]; dark[t] = m[2]; }
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink2', 'bg'], ['ink2', 'surface'], ['ink2', 'surface2'],
  ['accent', 'bg'], ['accent', 'surface'], ['accent-ink', 'accent'], ['warn-ink', 'warn-bg'],
  ['bad', 'bg'], ['bad-ink', 'bad'], ['mark-ink', 'mark'],
];
const NONTEXT = [
  ['line-strong', 'bg'], ['line-strong', 'surface'], ['line-strong', 'surface2'],
  ['warn-line', 'warn-bg'], ['cur-line', 'surface'], ['accent', 'accent-soft'],
];

const NUMS = ['tag-l', 'tag-c', 'tagfg-l', 'tagfg-c', 'tagbd-l', 'tagbd-c', 'shadow'];

describe('tokens.css', () => {
  it('all 19 colour tokens are light-dark(hex, hex) in :root', () => {
    for (const t of TOKENS) {
      expect(root[t], t).toBeDefined();
      expect(light[t], `${t} light`).toMatch(HEX);
      expect(dark[t], `${t} dark`).toMatch(HEX);
    }
  });

  it('dark media block and forced dark block share tag numbers and shadow', () => {
    for (const k of NUMS) {
      expect(darkMedia[k], k).toBeDefined();
      expect(darkForced[k], k).toBe(darkMedia[k]);
    }
  });

  it('color-scheme is declared for each theme', () => {
    expect(scheme(':root {')).toBe('light dark');
    expect(scheme(':root[data-theme="dark"]')).toBe('dark');
    expect(scheme(':root[data-theme="light"]')).toBe('light');
  });

  for (const [name, p] of [['light', light], ['dark', dark]]) {
    describe(name, () => {
      for (const [fg, bg] of TEXT) it(`text ${fg}/${bg} >= 4.5`, () => expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5));
      for (const [fg, bg] of NONTEXT) it(`non-text ${fg}/${bg} >= 3`, () => expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(3));
    });
  }

  it('prefers-contrast: more maps --line to --line-strong', () => {
    expect(css).toMatch(/prefers-contrast:\s*more\)\s*\{[^}]*--line:\s*var\(--line-strong\)/);
  });
});
