// @vitest-environment node
// El conector para Claude Desktop (mcp/core.mjs) en Node, sin DOM del navegador: lee, anonimiza y restaura en disco,
// y nunca devuelve un valor real. Datos: el contrato de ejemplo de la página (sintético).
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { anonymizeFile, readProtected, restore, ToolError, CHUNK_CHARS } from '../mcp/core.mjs';
import { buildDocx, openDocx, SAMPLE_PARAGRAPHS } from '../src/model/index.js';
import { writeTextPdf } from '../src/model/pdf/writer.js';

const plain = SAMPLE_PARAGRAPHS.map((p) => (typeof p === 'string' ? p : p.runs.map((r) => r.t).join('')));
const REAL = ['Carlos Andrés Mendoza Ríos', '1.047.382.915', '901.234.567-8', 'Laura Patricia'];
const noRealValue = (value) => { for (const v of REAL) expect(JSON.stringify(value)).not.toContain(v); };

let dir;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'minoscreto-mcp-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function writeSample(ext) {
  const path = join(dir, `Contrato_sintetico.${ext}`);
  if (ext === 'txt') await writeFile(path, plain.join('\n'));
  if (ext === 'docx') await writeFile(path, new Uint8Array(await buildDocx(plain)));
  if (ext === 'pdf') await writeFile(path, (await writeTextPdf({ lines: plain })).bytes);
  return path;
}

describe('anonymizeFile', () => {
  it.each(['txt', 'docx', 'pdf'])('%s: writes protected text + dictionary and returns no real value', async (ext) => {
    const result = await anonymizeFile({ ruta: await writeSample(ext) });
    noRealValue(result);
    expect(result.text).toMatch(/\[PERSONA_\d+\]/);
    expect(result.text).toMatch(/\[CEDULA_\d+\]/);
    expect(result.byType.PERSONA).toBeGreaterThan(0);
    const saved = await readFile(result.protectedPath, 'utf8');
    expect(saved).toBe(result.text);
    noRealValue(saved);
    expect(result.protectedPath).toMatch(/documento-[A-Z0-9]{4}_protegido\.md$/);
    expect(result.dictionaryPath).toMatch(/Contrato_sintetico_diccionario-[A-Z0-9]{4}\.json$/);
    const dict = JSON.parse(await readFile(result.dictionaryPath, 'utf8'));
    expect(Object.values(dict)).toContain('Carlos Andrés Mendoza Ríos');
  });

  it('mantener leaves a label in clear; agregar hides an extra text', async () => {
    const ruta = await writeSample('txt');
    const first = await anonymizeFile({ ruta });
    const dict = JSON.parse(await readFile(first.dictionaryPath, 'utf8'));
    const label = Object.keys(dict).find((k) => dict[k] === 'Carlos Andrés Mendoza Ríos').slice(1, -1);
    const second = await anonymizeFile({ ruta, mantener: [label, 'PERSONA_99'], agregar: ['venta de artesanías'] });
    expect(second.text).toContain('Carlos Andrés Mendoza Ríos');
    expect(second.text).not.toContain('venta de artesanías');
    expect(second.text).toMatch(/\[DATO_\d+\]/);
    expect(second.unknownKeep).toEqual(['PERSONA_99']);
  });

  it('refuses relative paths, unknown types, missing files and password PDFs', async () => {
    await expect(anonymizeFile({ ruta: 'caso.pdf' })).rejects.toThrow(ToolError);
    await expect(anonymizeFile({ ruta: join(dir, 'x.xlsx') })).rejects.toThrow(/Recibo PDF/);
    await expect(anonymizeFile({ ruta: join(dir, 'no.pdf') })).rejects.toThrow(/No existe/);
    await expect(anonymizeFile({ ruta: join(import.meta.dirname, 'fixtures', 'contrasena_usuario_sintetico.pdf'), carpetaSalida: dir }, { askPassword: null }))
      .rejects.toThrow(/contraseña/);
  });


  it('never overwrites: a second run with the same name gets a new file', async () => {
    const ruta = await writeSample('txt');
    await anonymizeFile({ ruta });
    await anonymizeFile({ ruta });
    expect((await readdir(dir)).filter((f) => f.endsWith('.json'))).toHaveLength(2);
  });
});

describe('PDF with a password (asked outside the chat)', () => {
  const LOCKED = join(import.meta.dirname, 'fixtures', 'contrasena_usuario_sintetico.pdf');
  const PASSWORD = 'minoscreto-prueba';
  const asker = (answers) => {
    const calls = [];
    const fn = async (request) => { calls.push(request); return answers.shift() ?? null; };
    return Object.assign(fn, { calls });
  };

  it('opens with the right password and never returns it', async () => {
    const ask = asker([PASSWORD]);
    const result = await anonymizeFile({ ruta: LOCKED, carpetaSalida: dir }, { askPassword: ask });
    expect(ask.calls).toEqual([{ fileName: 'contrasena_usuario_sintetico.pdf', reason: 'need' }]);
    expect(result.text.length).toBeGreaterThan(100);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    for (const f of await readdir(dir)) expect(await readFile(join(dir, f), 'utf8')).not.toContain(PASSWORD);
  });

  it('asks again after a wrong password, then opens', async () => {
    const ask = asker(['mala', PASSWORD]);
    await anonymizeFile({ ruta: LOCKED, carpetaSalida: dir }, { askPassword: ask });
    expect(ask.calls.map((c) => c.reason)).toEqual(['need', 'incorrect']);
  });

  it('stops after 3 wrong passwords, on cancel, and when the window fails', async () => {
    const wrong = asker(['a', 'b', 'c', 'd']);
    await expect(anonymizeFile({ ruta: LOCKED, carpetaSalida: dir }, { askPassword: wrong })).rejects.toThrow(/3 veces/);
    expect(wrong.calls).toHaveLength(3);
    await expect(anonymizeFile({ ruta: LOCKED, carpetaSalida: dir }, { askPassword: asker([]) })).rejects.toThrow(/canceló/);
    const broken = async () => { throw new Error('window'); };
    await expect(anonymizeFile({ ruta: LOCKED, carpetaSalida: dir }, { askPassword: broken })).rejects.toThrow(/ventana/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('restore reads a locked AI PDF with the password too', async () => {
    const dictionaryPath = join(dir, 'Caso_diccionario-7K3D.json');
    await writeFile(dictionaryPath, JSON.stringify({ '[PERSONA_1]': 'Nadie Real' }));
    const ask = asker([PASSWORD]);
    const r = await restore({ ruta: LOCKED, diccionario: dictionaryPath, formato: 'txt' }, { askPassword: ask });
    expect(ask.calls).toHaveLength(1);
    expect((await readFile(r.outPath, 'utf8')).length).toBeGreaterThan(50);
  });
});

describe('readProtected', () => {
  it('reads chunks of a protected file and refuses any other file', async () => {
    const result = await anonymizeFile({ ruta: await writeSample('txt') });
    const all = await readProtected({ ruta: result.protectedPath });
    expect(all.text).toBe(result.text);
    expect(all.more).toBe(false);
    const tail = await readProtected({ ruta: result.protectedPath, desde: 10 });
    expect(tail.text).toBe(result.text.slice(10, 10 + CHUNK_CHARS));
    await expect(readProtected({ ruta: result.dictionaryPath })).rejects.toThrow(/protegido/);
    await expect(readProtected({ ruta: join(dir, 'Contrato_sintetico.txt') })).rejects.toThrow(/protegido/);
  });
});

describe('restore', () => {
  async function prepared() {
    const result = await anonymizeFile({ ruta: await writeSample('txt') });
    const dict = JSON.parse(await readFile(result.dictionaryPath, 'utf8'));
    const tag = Object.keys(dict).find((k) => dict[k] === 'Carlos Andrés Mendoza Ríos');
    return { ...result, tag };
  }

  it('text → Word next to the dictionary, with the real name; the reply has no real value', async () => {
    const { dictionaryPath, tag } = await prepared();
    const r = await restore({ texto: `Resumen: ${tag} es el arrendatario. [PERSONA_77] firma.`, diccionario: dictionaryPath });
    noRealValue(r);
    expect(r.outPath).toMatch(/Contrato_sintetico-restaurado\.docx$/);
    expect(r.replaced).toBe(1);
    expect(r.unknown).toEqual(['[PERSONA_77]']);
    const doc = await openDocx((await readFile(r.outPath)).buffer);
    expect(doc.paragraphs.map((p) => p.text).join('\n')).toContain('Resumen: Carlos Andrés Mendoza Ríos es el arrendatario.');
  });

  it('protected .md → .md: header and page marks go, every value comes back', async () => {
    const { protectedPath, dictionaryPath } = await prepared();
    const r = await restore({ ruta: protectedPath, diccionario: dictionaryPath });
    const text = await readFile(r.outPath, 'utf8');
    expect(r.outPath).toMatch(/-restaurado\.md$/);
    expect(text).not.toContain('(anonimizado)');
    for (const v of REAL) expect(text).toContain(v);
    expect(text).not.toMatch(/\[(PERSONA|CEDULA|NIT)_\d+\]/);
  });

  it('AI Word and AI PDF files with tags are restored', async () => {
    const { dictionaryPath, tag } = await prepared();
    const docxIn = join(dir, 'respuesta.docx');
    await writeFile(docxIn, new Uint8Array(await buildDocx([`El arrendatario es ${tag}.`])));
    const word = await restore({ ruta: docxIn, diccionario: dictionaryPath });
    const doc = await openDocx((await readFile(word.outPath)).buffer);
    expect(doc.paragraphs.map((p) => p.text).join('\n')).toContain('El arrendatario es Carlos Andrés Mendoza Ríos.');

    const pdfIn = join(dir, 'respuesta.pdf');
    await writeFile(pdfIn, (await writeTextPdf({ lines: [`El arrendatario es ${tag}.`] })).bytes);
    const pdf = await restore({ ruta: pdfIn, diccionario: dictionaryPath, formato: 'txt' });
    expect(pdf.outPath).toMatch(/\.txt$/);
    expect(await readFile(pdf.outPath, 'utf8')).toContain('El arrendatario es Carlos Andrés Mendoza Ríos.');
  });

  it('needs exactly one of texto/ruta, a valid dictionary, and never overwrites', async () => {
    const { dictionaryPath, tag, protectedPath } = await prepared();
    await expect(restore({ diccionario: dictionaryPath })).rejects.toThrow(/uno de los dos/);
    await expect(restore({ texto: 'x', ruta: protectedPath, diccionario: dictionaryPath })).rejects.toThrow(/uno de los dos/);
    await expect(restore({ texto: tag, diccionario: protectedPath })).rejects.toThrow(/Diccionario no válido/);
    const a = await restore({ texto: tag, diccionario: dictionaryPath, formato: 'md' });
    const b = await restore({ texto: tag, diccionario: dictionaryPath, formato: 'md' });
    expect(b.outPath).not.toBe(a.outPath);
    expect(b.outPath).toMatch(/ \(2\)\.md$/);
  });
});
