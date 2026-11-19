#!/usr/bin/env node
// Conector local (MCP, stdio) de Minoscreto para Claude Desktop. Todo ocurre en este PC: el documento original
// nunca se envía; a Claude solo le llega el texto con etiquetas [TIPO_n], conteos y rutas.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { anonymizeFile, readProtected, restore, ToolError } from './core.mjs';
import { unitOf } from '../src/model/expediente/render.js';

const PRIVACY = 'Nunca abras ni leas el archivo del diccionario: tiene los datos reales. Pide al usuario rutas de archivos; '
  + 'si pega el documento original en el chat, los datos ya salieron del PC.';

// Va en las instrucciones del servidor (las lee Claude al conectarse): con herramientas de archivos propias (pestaña
// Code, Cowork, un conector de archivos), Claude abría el PDF original antes de llamar a anonimizar.
const INSTRUCTIONS = [
  'Minoscreto protege datos personales de documentos legales. Regla obligatoria:',
  '1. Cuando el usuario nombre un documento (PDF, Word, .txt, .md) para anonimizar, resumir, analizar o trabajar con él, '
    + 'llama PRIMERO a anonimizar con su ruta completa. NO abras, leas, listes ni conviertas el archivo original con ninguna '
    + 'otra herramienta (lectura de archivos, terminal, Python, skills de PDF o Word, conectores de archivos): eso envía los datos reales.',
  '2. Trabaja solo con el texto protegido que devuelve anonimizar (y leer_protegido si es largo). Usa las etiquetas [TIPO_n] tal cual.',
  '3. Nunca abras el archivo …_diccionario-….json: tiene los datos reales. Para entregar algo con los datos reales, usa restaurar.',
  '4. Si no tienes la ruta completa, pídesela al usuario; no busques el archivo explorando carpetas.'
].join('\n');

const server = new McpServer({ name: 'minoscreto', version: '0.1.1' }, { instructions: INSTRUCTIONS });

const reply = (text) => ({ content: [{ type: 'text', text }] });
const fail = (error) => ({
  isError: true,
  content: [{ type: 'text', text: error instanceof ToolError ? error.message : `Error inesperado: ${error?.message || error}` }]
});
const run = (fn) => async (args) => { try { return reply(await fn(args)); } catch (error) { return fail(error); } };

server.registerTool('anonimizar', {
  title: 'Anonimizar documento',
  description: 'Úsala ANTES de abrir cualquier documento del usuario y en lugar de leerlo con otras herramientas. Anonimiza un PDF, Word (.docx), .txt o .md del disco de este PC con Minoscreto. Cambia nombres, cédulas, NIT, '
    + 'direcciones, teléfonos, correos, cuentas, radicados y placas por etiquetas como [PERSONA_1]. Guarda junto al original '
    + '(o en carpeta_salida) el texto protegido «documento-CODIGO_protegido.md» y el diccionario «Nombre_diccionario-CODIGO.json», '
    + 'y devuelve el texto protegido para trabajar con él. Si es largo, devuelve el primer trozo: pide el resto con leer_protegido. '
    + `Para corregir la detección, vuelve a llamarla con mantener (etiquetas que no se ocultan) o agregar (textos que sí). ${PRIVACY}`,
  inputSchema: {
    ruta: z.string().describe('Ruta completa del documento, p. ej. C:\\Users\\Ana\\Documents\\caso.pdf'),
    reducir: z.boolean().optional().describe('Quitar encabezados, pies y números de página repetidos (menos texto). Por defecto no.'),
    mantener: z.array(z.string()).optional().describe('Etiquetas que deben quedar con su valor real, p. ej. ["PERSONA_3"] (un juez, una entidad pública).'),
    agregar: z.array(z.string()).optional().describe('Textos que la detección no ocultó y deben ocultarse (quedan como [DATO_n]).'),
    carpeta_salida: z.string().optional().describe('Carpeta donde guardar los dos archivos. Por defecto, la del documento.')
  }
}, run(async ({ ruta, reducir, mantener, agregar, carpeta_salida }) => {
  const r = await anonymizeFile({ ruta, reducir, mantener, agregar, carpetaSalida: carpeta_salida });
  const types = Object.entries(r.byType).map(([t, n]) => `${t}: ${n}`).join(', ') || 'ninguno';
  const lines = [
    `Anonimizado (código ${r.code}). ${r.pages} ${r.pages === 1 ? unitOf(r.unit).one : unitOf(r.unit).many}, ${r.replacements} reemplazos.`,
    `Datos ocultos por tipo: ${types}.`,
    `Texto protegido: ${r.protectedPath}`,
    `Diccionario (datos reales, no abrirlo): ${r.dictionaryPath}`
  ];
  if (r.emptyPages.length) lines.push(`Aviso: ${r.emptyPages.length} folio(s) sin texto legible (${r.emptyPages.join(', ')}); si son escaneos, hazles OCR.`);
  if (r.unknownKeep.length) lines.push(`Estas etiquetas de «mantener» no existen: ${r.unknownKeep.join(', ')}.`);
  if (r.more) lines.push(`El texto tiene ${r.totalChars} caracteres; aquí van los primeros ${r.text.length}. Sigue con leer_protegido (desde ${r.text.length}).`);
  return `${lines.join('\n')}\n\n---\n${r.text}`;
}));

server.registerTool('leer_protegido', {
  title: 'Leer más del texto protegido',
  description: 'Devuelve un trozo (hasta 100 000 caracteres) de un archivo «…_protegido.md» que escribió anonimizar. '
    + 'Solo abre esos archivos, nunca un original ni un diccionario.',
  inputSchema: {
    ruta: z.string().describe('Ruta completa del archivo …_protegido.md'),
    desde: z.number().int().min(0).optional().describe('Carácter desde el que leer (0 = inicio).')
  }
}, run(async ({ ruta, desde }) => {
  const r = await readProtected({ ruta, desde });
  const tail = r.more ? `Sigue con leer_protegido (desde ${r.to}).` : 'Fin del texto.';
  return `Caracteres ${r.from}–${r.to} de ${r.totalChars}. ${tail}\n\n---\n${r.text}`;
}));

server.registerTool('restaurar', {
  title: 'Restaurar datos reales',
  description: 'Pone los valores reales en lugar de las etiquetas [TIPO_n] y GUARDA el resultado en el disco (Word, PDF, .md o .txt). '
    + 'Pasa texto (lo que escribiste con las etiquetas) o ruta (un archivo con etiquetas: .docx, .pdf, .md, .txt), y el diccionario '
    + 'de ese documento. No devuelve el texto restaurado, solo dónde quedó: los datos reales no vuelven al chat. '
    + 'Usa las etiquetas exactamente como aparecen en el texto protegido.',
  inputSchema: {
    diccionario: z.string().describe('Ruta completa del …_diccionario-CODIGO.json (o del .zip que lo trae).'),
    texto: z.string().optional().describe('Texto con etiquetas a restaurar.'),
    ruta: z.string().optional().describe('Ruta de un archivo con etiquetas a restaurar.'),
    formato: z.enum(['docx', 'pdf', 'md', 'txt']).optional().describe('Formato de salida si no das ruta_salida. Por defecto docx (o el del archivo).'),
    ruta_salida: z.string().optional().describe('Ruta completa del archivo a crear. Por defecto «Nombre-restaurado.<ext>» junto al diccionario. Nunca sobrescribe.')
  }
}, run(async ({ diccionario, texto, ruta, formato, ruta_salida }) => {
  const r = await restore({ diccionario, texto, ruta, formato, rutaSalida: ruta_salida });
  const lines = [`Restaurado: ${r.replaced} etiquetas cambiadas por sus valores reales.`, `Archivo: ${r.outPath}`];
  if (r.unknown.length) lines.push(`Etiquetas que el diccionario no tiene (quedaron igual): ${r.unknown.join(', ')}.`);
  if (r.omittedChars) lines.push('Algunos caracteres no caben en la fuente del PDF y se omitieron; usa Word si importan.');
  return lines.join('\n');
}));

await server.connect(new StdioServerTransport());
