import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// CSP de Netlify (dist/_headers). Los scripts van en línea y cambian en cada build, así que se autorizan por hash.
// connect-src 'self': la página solo puede pedir a su propio origen (el motor); solo carga las fuentes de Google.
function cspHeaders() {
  let outDir;
  return {
    name: 'minoscreto-csp',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter(([, attrs]) => !/\btype\s*=\s*["']?application\/ld\+json/i.test(attrs)) // JSON-LD no se ejecuta: sin hash
        .map(([, , body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
      const csp = [
        "default-src 'none'",
        // 'wasm-unsafe-eval' solo deja compilar WebAssembly (el motor PDFium); no habilita eval de JS.
        `script-src ${hashes.join(' ')} 'wasm-unsafe-eval'`,
        "style-src 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com data:',
        "img-src 'self' data: blob:",
        'worker-src blob: data:',
        // 'self': la única petición es el GET de los dos archivos del motor en /engine/ (ADR-004, S6).
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; ');
      writeFileSync(resolve(outDir, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n`);
    }
  };
}

// Motor PDFium (ADR-004): dos archivos aparte con hash en el nombre, nunca dentro de index.html.
//   dist/engine/worker.<h8>.js    src/engine-worker/ + glue de EmbedPDF, un solo script clásico (corre en un worker blob:)
//   dist/engine/embedpdf.<h8>.wasm  copia exacta del wasm del paquete
// La página los recibe en `virtual:minoscreto-engine` como ENGINE = { worker, wasm } con { url, sha256 } (hex).
// Fuera del build (dev, tests) ENGINE es null: no hay motor y se usa el PDF de texto.
const ENGINE_ID = 'virtual:minoscreto-engine';
const ENGINE_WASM = 'node_modules/@embedpdf/engine-runtime-wasm32/lib/embedpdf.wasm';

async function bundleEngineWorker(root) {
  const result = await viteBuild({
    configFile: false,
    root,
    logLevel: 'silent',
    // El glue calcula new URL('embedpdf.wasm', import.meta.url) aunque no lo use (los bytes llegan por mensaje).
    // En un script clásico import.meta no existe, y en modo librería Vite metería el wasm en base64 dentro del
    // worker (+10 MB). Antes de que Vite lo vea, import.meta.url pasa a ser la URL del worker.
    plugins: [{
      name: 'minoscreto-engine-no-import-meta',
      enforce: 'pre',
      transform(code, id) {
        if (!id.includes('@embedpdf') || !code.includes('import.meta.url')) return null;
        return { code: code.replaceAll('import.meta.url', 'self.location.href'), map: null };
      }
    }],
    build: {
      write: false,
      emptyOutDir: false,
      minify: true,
      assetsInlineLimit: 0,
      lib: { entry: resolve(root, 'src/engine-worker/index.js'), formats: ['iife'], name: 'MinoscretoEngine', fileName: () => 'worker.js' },
      rolldownOptions: { output: { codeSplitting: false } }
    }
  });
  const chunks = [result].flat()[0].output.filter((item) => item.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`engineAsset: el worker debe ser un solo archivo, salieron ${chunks.length}`);
  return chunks[0].code;
}

function engineAsset() {
  let isBuild = false;
  let root;
  let files = null;
  return {
    name: 'minoscreto-engine-asset',
    configResolved(config) {
      isBuild = config.command === 'build' && !config.build.ssr;
      root = config.root;
    },
    async buildStart() {
      if (!isBuild) return;
      const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
      const worker = Buffer.from(await bundleEngineWorker(root), 'utf8');
      const wasm = readFileSync(resolve(root, ENGINE_WASM));
      const workerSha = sha(worker);
      const wasmSha = sha(wasm);
      files = {
        worker: { fileName: `engine/worker.${workerSha.slice(0, 8)}.js`, source: worker, sha256: workerSha },
        wasm: { fileName: `engine/embedpdf.${wasmSha.slice(0, 8)}.wasm`, source: wasm, sha256: wasmSha }
      };
    },
    resolveId(id) {
      return id === ENGINE_ID ? `\0${ENGINE_ID}` : null;
    },
    load(id) {
      if (id !== `\0${ENGINE_ID}`) return null;
      if (!files) return 'export const ENGINE = null;\n';
      const entry = ({ fileName, sha256 }) => ({ url: `/${fileName}`, sha256 });
      return `export const ENGINE = ${JSON.stringify({ worker: entry(files.worker), wasm: entry(files.wasm) })};\n`;
    },
    generateBundle() {
      if (!files) return;
      // Como asset (no chunk), vite-plugin-singlefile no lo mete en index.html.
      for (const { fileName, source } of Object.values(files)) this.emitFile({ type: 'asset', fileName, source });
    }
  };
}

// Lista de palabras comunes (ADR-012): un archivo aparte con hash en el nombre, nunca dentro de index.html.
//   dist/data/common-nouns.<h8>.txt   copia exacta de src/model/data/common-nouns.txt
// La página la recibe en `virtual:minoscreto-data` como COMMON_NOUNS_FILE = { url, sha256 } (hex).
// Fuera del build (dev, tests) es null: no hay lista y todo funciona como sin ella.
const DATA_ID = 'virtual:minoscreto-data';
const COMMON_NOUNS_SRC = 'src/model/data/common-nouns.txt';

function commonNounsAsset() {
  let isBuild = false;
  let root;
  let file = null;
  return {
    name: 'minoscreto-common-nouns-asset',
    configResolved(config) {
      isBuild = config.command === 'build' && !config.build.ssr;
      root = config.root;
    },
    buildStart() {
      if (!isBuild) return;
      const source = readFileSync(resolve(root, COMMON_NOUNS_SRC));
      const sha256 = createHash('sha256').update(source).digest('hex');
      file = { fileName: `data/common-nouns.${sha256.slice(0, 8)}.txt`, source, sha256 };
    },
    resolveId(id) {
      return id === DATA_ID ? `\0${DATA_ID}` : null;
    },
    load(id) {
      if (id !== `\0${DATA_ID}`) return null;
      if (!file) return 'export const COMMON_NOUNS_FILE = null;\n';
      return `export const COMMON_NOUNS_FILE = ${JSON.stringify({ url: `/${file.fileName}`, sha256: file.sha256 })};\n`;
    },
    generateBundle() {
      if (file) this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
    }
  };
}

export default defineConfig({
  plugins: [react(), { ...viteSingleFile(), apply: 'build' }, engineAsset(), commonNounsAsset(), cspHeaders()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{js,jsx}']
  }
});
