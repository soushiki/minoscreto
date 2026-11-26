// Lista de palabras comunes (ADR-012, T1): archivo, lexicon, carga verificada y paso al worker. Nada la usa aún.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMON_NOUNS, parseCommonNouns, setCommonNouns } from '../src/model/lexicon.js';
import { loadCommonNouns } from '../src/model/engine/loader.js';
import { runTask } from '../src/workers/expedienteTasks.js';

const file = readFileSync(resolve(__dirname, '../src/model/data/common-nouns.txt'), 'utf8');
const bytes = new TextEncoder().encode('# cabecera\nInformación\n\nEmpresa\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const okResponse = (b) => ({ ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });

afterEach(() => {
  setCommonNouns([]);
  vi.unstubAllGlobals();
});

describe('parseCommonNouns / setCommonNouns', () => {
  it('skips # and blank lines and folds', () => {
    expect(parseCommonNouns('# x\n\n  Información \r\nEmpresa\n')).toEqual(['informacion', 'empresa']);
  });

  it('replaces the contents of COMMON_NOUNS', () => {
    expect(COMMON_NOUNS.size).toBe(0);
    setCommonNouns(['Uno', 'dos']);
    expect([...COMMON_NOUNS]).toEqual(['uno', 'dos']);
    setCommonNouns(['tres']);
    expect([...COMMON_NOUNS]).toEqual(['tres']);
  });
});

describe('the shipped list', () => {
  it('parses to 35840 words with common words in and names out', () => {
    const words = parseCommonNouns(file);
    expect(words).toHaveLength(35840);
    expect(new Set(words).size).toBe(35840);
    for (const w of ['empresa', 'importante', 'informacion', 'ciclo', 'ciudadania']) expect(words).toContain(w);
    for (const w of ['jack', 'londres', 'mendoza', 'restrepo', 'jaime']) expect(words).not.toContain(w);
  });

  it('keeps the licence header', () => {
    expect(file).toContain('# This list is CC BY-SA 4.0');
    expect(file).toContain('Hermit Dave');
  });
});

describe('loadCommonNouns', () => {
  it('returns [] without a file (dev and tests)', async () => {
    expect(await loadCommonNouns(null)).toEqual([]);
  });

  it('returns the words when bytes and sha match', async () => {
    const fetchStub = vi.fn(async () => okResponse(bytes));
    vi.stubGlobal('fetch', fetchStub);
    expect(await loadCommonNouns({ url: '/data/common-nouns.abcd1234.txt', sha256: sha(bytes) })).toEqual(['informacion', 'empresa']);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the sha does not match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(bytes)));
    expect(await loadCommonNouns({ url: '/data/common-nouns.abcd1234.txt', sha256: 'f'.repeat(64) })).toEqual([]);
  });

  it('returns [] on a bad path without calling fetch', async () => {
    const fetchStub = vi.fn(async () => okResponse(bytes));
    vi.stubGlobal('fetch', fetchStub);
    for (const url of ['/x/y.txt', 'https://evil/x', '/engine/worker.js', '/data/../x']) {
      expect(await loadCommonNouns({ url, sha256: sha(bytes) })).toEqual([]);
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('returns [] when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await loadCommonNouns({ url: '/data/common-nouns.abcd1234.txt', sha256: sha(bytes) })).toEqual([]);
  });
});

describe('expediente worker task', () => {
  it('prepare sets COMMON_NOUNS from the message', () => {
    runTask('prepare', { paragraphs: [{ text: 'Hola mundo' }], commonNouns: ['empresa', 'Importante'] });
    expect([...COMMON_NOUNS]).toEqual(['empresa', 'importante']);
  });

  it('prepare without commonNouns leaves the set alone', () => {
    setCommonNouns(['x']);
    runTask('prepare', { paragraphs: [{ text: 'Hola mundo' }] });
    expect([...COMMON_NOUNS]).toEqual(['x']);
  });
});
