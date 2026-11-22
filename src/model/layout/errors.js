// Por qué no salió el PDF con diseño (diseño §Interfaces). Quien llama cae al PDF de texto de siempre y muestra
// el mensaje de esa razón; nunca sale un PDF con diseño a medias.
import { LOADER_CODES } from '../engine/loader.js';

export const LAYOUT_REASONS = Object.freeze(['scan', 'missed-value', 'engine', 'too-large', 'error']);

export class LayoutRefused extends Error {
  /**
   * @param {'scan' | 'missed-value' | 'engine' | 'too-large' | 'error'} reason
   * @param {{ cause?: unknown, pages?: number[], where?: string }} [details] pages: páginas (desde 1) escaneadas
   */
  constructor(reason, details = {}) {
    if (!LAYOUT_REASONS.includes(reason)) throw new TypeError(`LayoutRefused: razón desconocida ${reason}`);
    super(details.where ? `${reason}: ${details.where}` : reason, details.cause ? { cause: details.cause } : undefined);
    this.name = 'LayoutRefused';
    this.reason = reason;
    if (details.pages) this.pages = details.pages;
    if (details.where) this.where = details.where;
  }
}

// Códigos del motor (EngineError del cargador o PdfiumFault del worker) → razón.
// bad-input, no-document y bad-page serían un error nuestro al llamar: quedan como 'error'.
const ENGINE_CODES = new Set([
  ...LOADER_CODES, 'not-ready', 'bad-method',
  'font', 'lost-text', 'poisoned', 'redact', 'anchor', 'insert', 'generate', 'nested', 'save', 'page'
]);

/** Un fallo del motor o de PDFium como LayoutRefused; uno que ya lo es pasa tal cual. */
export function refusalFrom(error) {
  if (error instanceof LayoutRefused) return error;
  const code = error?.code;
  if (code === 'too-large') return new LayoutRefused('too-large', { cause: error, where: 'engine' });
  if (ENGINE_CODES.has(code)) return new LayoutRefused('engine', { cause: error, where: code });
  return new LayoutRefused('error', { cause: error, where: typeof code === 'string' ? code : 'unexpected' });
}
