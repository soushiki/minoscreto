// @vitest-environment node
// Fitness del build (ADR-004, S2, S4, R6): el motor sale en dos archivos aparte y la CSP cambia solo en lo de S2.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Script, createContext, runInContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { ENGINE } from 'virtual:minoscreto-engine';

const root = resolve(__dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
let outDir;
let html;
let engineFiles;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'minoscreto-build-'));
  // vitest pone NODE_ENV=test y Vite lo respeta (React de desarrollo); el build debe ser el de producción.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root, mode: 'production', configFile: resolve(root, 'vite.config.js'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  html = readFileSync(join(outDir, 'index.html'), 'utf8');
  engineFiles = readdirSync(join(outDir, 'engine')).sort();
}, 180_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const engineFile = (prefix) => engineFiles.find((name) => name.startsWith(prefix));

describe('ADR-004: engine stays out of the page', () => {
  it('index.html has no wasm bytes and no PDFium glue', () => {
    expect(html).not.toContain('AGFzbQ'); // "\0asm" en base64
    expect(html).not.toContain('FPDF_InitLibrary');
    expect(html).not.toContain('createPdfRuntimeWasm');
  });

  it('index.html stays at most 910 kB gzipped, as Vite reports it (S4)', () => {
    expect(gzipSync(html, { level: 9 }).length).toBeLessThanOrEqual(910_000);
  });

  it('emits exactly one worker and one wasm, each named by its SHA-256', () => {
    expect(engineFiles).toHaveLength(2);
    expect(engineFiles[0]).toMatch(/^embedpdf\.[0-9a-f]{8}\.wasm$/);
    expect(engineFiles[1]).toMatch(/^worker\.[0-9a-f]{8}\.js$/);
    for (const name of engineFiles) {
      const hash = sha256(readFileSync(join(outDir, 'engine', name)));
      expect(name.split('.')[1]).toBe(hash.slice(0, 8));
    }
  });

  it('the wasm is the pinned package file, byte for byte', () => {
    const shipped = readFileSync(join(outDir, 'engine', engineFile('embedpdf.')));
    const pinned = readFileSync(resolve(root, 'node_modules/@embedpdf/engine-runtime-wasm32/lib/embedpdf.wasm'));
    expect(sha256(shipped)).toBe(sha256(pinned));
  });

  it('the worker is one classic script: no import/export, no import.meta, no inlined wasm', () => {
    const code = readFileSync(join(outDir, 'engine', engineFile('worker.')), 'utf8');
    expect(() => new Script(code)).not.toThrow(); // import/export estáticos no compilan como script clásico
    expect(code).not.toMatch(/import\.meta/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toContain('AGFzbQ');
    expect(code).toContain('FPDF_InitLibrary');
  });

  it('the built worker boots PDFium in a blob: worker scope from the wasm bytes alone', async () => {
    const code = readFileSync(join(outDir, 'engine', engineFile('worker.')), 'utf8');
    const wasm = readFileSync(join(outDir, 'engine', engineFile('embedpdf.')));
    // Ámbito de worker sin process ni import.meta, con la URL blob: que tendrá en el navegador.
    class WorkerGlobalScope {}
    const self = new WorkerGlobalScope();
    self.location = { href: 'blob:https://minoscreto.test/0000' };
    const replies = [];
    const ready = new Promise((done) => { self.postMessage = (message) => { replies.push(message); done(message); }; });
    const scope = createContext({ self, WorkerGlobalScope, location: self.location, WebAssembly, console, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance });
    scope.globalThis = scope;
    runInContext(code, scope);
    await self.onmessage({ data: { type: 'init', wasmBinary: new Uint8Array(wasm) } });
    expect(await ready).toEqual({ type: 'ready' });
    await self.onmessage({ data: { type: 'init', wasmBinary: new Uint8Array(wasm) } }); // un segundo init no crea otro motor
    expect(replies).toHaveLength(1);
    // El bundle trae el wrapper de PDFium (T4): abre una fixture y da las señales de escaneo.
    const pdf = new Uint8Array(readFileSync(resolve(root, 'tests/fixtures/tabla_sintetico.pdf')));
    await self.onmessage({ data: { type: 'call', id: 1, method: 'open', args: [pdf, ''] } });
    await self.onmessage({ data: { type: 'call', id: 2, method: 'pageStats', args: [0] } });
    await self.onmessage({ data: { type: 'call', id: 3, method: 'close', args: [] } });
    expect(replies.slice(1)).toEqual([
      { type: 'result', id: 1, ok: true, result: { pageCount: 2 } },
      { type: 'result', id: 2, ok: true, result: expect.objectContaining({ hasImages: false, invisibleChars: 0 }) },
      { type: 'result', id: 3, ok: true, result: undefined }
    ]);
  }, 60_000);

  it('outside a build ENGINE is null (no engine in dev or tests)', () => {
    expect(ENGINE).toBeNull();
  });
});

describe('S2: CSP changes only by wasm-unsafe-eval and connect-src self', () => {
  it('matches the expected policy exactly, apart from the script hashes', () => {
    const headers = readFileSync(join(outDir, '_headers'), 'utf8');
    const csp = headers.match(/Content-Security-Policy: (.*)/)[1].replace(/'sha256-[A-Za-z0-9+/=]+'/g, 'HASH');
    expect(csp).toBe([
      "default-src 'none'",
      "script-src HASH 'wasm-unsafe-eval'",
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com data:',
      'img-src data: blob:',
      'worker-src blob: data:',
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join('; '));
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers.match(/^\S/gm)).toEqual(['/']); // una sola regla, en /*
  });

  it('netlify.toml caches /engine/* as immutable and sets no CSP there', () => {
    const toml = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
    const rule = toml.split('[[headers]]').find((block) => block.includes('for = "/engine/*"'));
    expect(rule).toContain('Cache-Control = "public, max-age=31536000, immutable"');
    expect(rule).not.toContain('Content-Security-Policy');
  });
});
