import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { toWinAnsi } from '../src/model/pdf/winAnsi.js';
import { writeTextPdf } from '../src/model/pdf/writer.js';

describe('toWinAnsi (C3, S5)', () => {
  it('keeps every Spanish letter and sign unchanged', () => {
    const spanish = 'áéíóúÁÉÍÓÚüÜñÑ ¿Qué? ¡Sí! 1º 2ª «cita» € — – … ½';
    expect(toWinAnsi(spanish)).toEqual({ text: spanish, replaced: [], dropped: [] });
  });

  it('composes decomposed accents before checking them', () => {
    expect(toWinAnsi('Jiménez Muñoz').text).toBe('Jiménez Muñoz');
  });

  it.each([
    ['• punto', '* punto', ['•']],
    ['edad ≥ 18', 'edad >= 18', ['≥']],
    ['monto ≤ 5', 'monto <= 5', ['≤']],
    ['a ≠ b', 'a != b', ['≠']],
    ['paso → fin', 'paso -> fin', ['→']],
    ['“cita” y ‘otra’', '"cita" y \'otra\'', ['“', '”', '‘', '’']],
    ['5 − 3', '5 - 3', ['−']],
    ['a b c', 'a b c', [' ', ' ']],
    ['col1\tcol2', 'col1 col2', ['\t']],
  ])('approximates %j', (input, text, replaced) => {
    expect(toWinAnsi(input)).toEqual({ text, replaced, dropped: [] });
  });

  it('drops emoji and CJK and lists each once', () => {
    const out = toWinAnsi('Hola 😀 mundo 中文 😀');
    expect(out.text).toBe('Hola  mundo  ');
    expect(out.dropped).toEqual(['😀', '中', '文']);
  });

  it('drops invisible joiners silently (no warning for what nobody sees)', () => {
    expect(toWinAnsi('a​b﻿c👍️')).toEqual({ text: 'abc', replaced: [], dropped: ['👍'] });
  });

  it('keeps line breaks and tags intact', () => {
    const s = '# RESUELVE\n[PERSONA_1] y [EMPRESA_2]';
    expect(toWinAnsi(s).text).toBe(s);
  });

  it('never throws on odd input', () => {
    for (const bad of ['', '\uD800', '\u0000\u0007', 'x'.repeat(10000), null, undefined, 42]) {
      expect(() => toWinAnsi(bad)).not.toThrow();
    }
    expect(toWinAnsi('\uD800a').text).toBe('a');
    expect(toWinAnsi(null).text).toBe('');
  });
});

async function readBack(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => i.str).join('\n'));
  }
  const meta = await doc.getMetadata();
  await task.destroy();
  return { pages, meta };
}

describe('writeTextPdf (C4, R2, S4, S5, S6)', () => {
  it('writes accents, headings and a footer on every page', async () => {
    const { bytes, dropped } = await writeTextPdf({ lines: ['# Resuelve', 'Jiménez Muñoz ¿Sí? ¡Claro!', '', 'fin'] });
    const { pages } = await readBack(bytes);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('Resuelve');
    expect(pages[0]).toContain('Jiménez Muñoz ¿Sí? ¡Claro!');
    expect(pages[0]).toContain('Página 1 de 1');
    expect(dropped).toEqual([]);
  });

  it('keeps every tag in one piece when wrapping', async () => {
    const tags = Array.from({ length: 60 }, (_, i) => `[PERSONA_${i + 1}]`);
    const line = tags.map((t) => `texto ${t},`).join(' ');
    const { bytes } = await writeTextPdf({ lines: [line, 'x'.repeat(300) + '[EMPRESA_1]' + 'y'.repeat(200)] });
    const { pages } = await readBack(bytes);
    const all = pages.join('\n');
    for (const t of tags) expect(all).toContain(t);
    expect(all).toContain('[EMPRESA_1]');
    expect(all.match(/\[[A-Z_0-9]+\]/g)).toHaveLength(61);
    expect(all).not.toMatch(/\[[A-Z_0-9]*(\n|$)/);
  });

  it('paginates, numbers pages and reports progress', async () => {
    const seen = [];
    const lines = Array.from({ length: 120 }, (_, i) => `línea ${i}`);
    const { bytes } = await writeTextPdf({ lines, onProgress: (d, t) => seen.push([d, t]) });
    const { pages } = await readBack(bytes);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.at(-1)).toContain(`Página ${pages.length} de ${pages.length}`);
    expect(seen.at(-1)).toEqual([pages.length, pages.length]);
  });

  it('reports replaced and dropped glyphs and never throws', async () => {
    const out = await writeTextPdf({ lines: ['• edad ≥ 18 😀'] });
    expect(out.replaced).toEqual(['•', '≥']);
    expect(out.dropped).toEqual(['😀']);
    await expect(writeTextPdf({ lines: [] })).resolves.toHaveProperty('bytes');
    await expect(writeTextPdf({})).resolves.toHaveProperty('bytes');
  });

  it('writes only Minoscreto metadata (S4)', async () => {
    const { bytes } = await writeTextPdf({ lines: ['hola'] });
    const { meta } = await readBack(bytes);
    expect(meta.info.Producer).toBe('Minoscreto');
    expect(meta.info.Creator).toBe('Minoscreto');
    for (const key of ['Title', 'Author', 'Subject', 'Keywords']) expect(meta.info[key] ?? '').toBe('');
  });

  it('writes 200 pages in 2 s or less', async () => {
    const lines = Array.from({ length: 200 * 46 }, (_, i) => `Línea ${i} de prueba con [PERSONA_${i % 9}] y texto corriente`);
    const t0 = performance.now();
    const { bytes } = await writeTextPdf({ lines });
    const ms = performance.now() - t0;
    const { pages } = await readBack(bytes);
    console.log(`200-page write: ${Math.round(ms)} ms, ${pages.length} pages`);
    expect(pages.length).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThanOrEqual(2000);
  }, 30000);

  it('ADR-001: pdf-lib must load lazily from src/model/pdf/', () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|mjs)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          if (/['"]pdf-lib['"]/.test(src)) hits.push({ p: p.split(path.sep).join('/'), src });
        }
      }
    };
    walk(path.resolve(__dirname, '../src'));
    // ADR-001 (enmendado 2026-11-19): solo archivos de src/model/pdf/ y solo con import() dinámico.
    const bad = hits.filter(({ p, src }) => !/src\/model\/pdf\/[^/]+\.js$/.test(p)
      || /^\s*import[^(]*from\s+['"]pdf-lib['"]/m.test(src) || !src.includes("import('pdf-lib')"));
    expect(bad.map((b) => b.p), 'ADR-001: pdf-lib must load lazily from src/model/pdf/').toEqual([]);
    expect(hits.map((h) => h.p.replace(/.*src\//, 'src/')).sort())
      .toEqual(['src/model/pdf/scrub.js', 'src/model/pdf/writer.js']);
  });

  it('FIX-8: the omitted-characters toast text lives in one constant', () => {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|mjs)$/.test(e.name) && /se omitieron/.test(fs.readFileSync(p, 'utf8'))) files.push(p.split(path.sep).join('/'));
      }
    };
    walk(path.resolve(__dirname, '../src'));
    expect(files.map((p) => p.replace(/^.*\/src\//, 'src/'))).toEqual(['src/viewmodels/messages.js']);
  });
});
