// Arma mcp/build/minoscreto.mcpb: copia el servidor y src/model a una carpeta limpia, instala solo las
// dependencias de producción y la empaqueta con la CLI oficial (@anthropic-ai/mcpb). Uso: npm run pack (en mcp/).
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const build = join(here, 'build');
const stage = join(build, 'minoscreto');

rmSync(build, { recursive: true, force: true });
mkdirSync(join(stage, 'mcp'), { recursive: true });
for (const f of ['server.mjs', 'core.mjs', 'dom.mjs']) cpSync(join(here, f), join(stage, 'mcp', f));
cpSync(join(root, 'src', 'model'), join(stage, 'src', 'model'), { recursive: true });
cpSync(join(here, 'manifest.json'), join(stage, 'manifest.json'));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
delete pkg.scripts;
writeFileSync(join(stage, 'package.json'), JSON.stringify({ ...pkg, main: 'mcp/server.mjs' }, null, 2));

// Sin opcionales: @napi-rs/canvas (dibujar páginas, binario de una sola plataforma) no hace falta para leer texto.
// Lo que el servidor nunca carga: el visor y la versión moderna de pdf.js (usa legacy/), tipos, mapas y fuentes TS.
writeFileSync(join(stage, '.mcpbignore'), [
  'node_modules/pdfjs-dist/build/', 'node_modules/pdfjs-dist/web/', 'node_modules/pdfjs-dist/types/',
  'node_modules/pdfjs-dist/image_decoders/', 'node_modules/zod/src/', '*.map', '*.d.ts', '*.d.mts', '*.d.cts'
].join('\n') + '\n');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
run('npm install --omit=dev --omit=optional --no-audit --no-fund', stage);
run('npx -y @anthropic-ai/mcpb@2.1.2 validate manifest.json', stage);
run(`npx -y @anthropic-ai/mcpb@2.1.2 pack . ${JSON.stringify(join(build, 'minoscreto.mcpb'))}`, stage);
