import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// CSP de Netlify (dist/_headers). Los scripts van en línea y cambian en cada build, así que se autorizan por hash.
// connect-src 'none': la página no puede enviar nada por red; solo carga las fuentes de Google.
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
      const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
      const csp = [
        "default-src 'none'",
        `script-src ${hashes.join(' ')}`,
        "style-src 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com data:',
        'img-src data: blob:',
        'worker-src blob: data:',
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; ');
      writeFileSync(resolve(outDir, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n`);
    }
  };
}

export default defineConfig({
  plugins: [react(), { ...viteSingleFile(), apply: 'build' }, cspHeaders()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{js,jsx}']
  }
});
