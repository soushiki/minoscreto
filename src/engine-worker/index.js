// Worker del motor PDFium (ADR-004/005). El build lo empaqueta aparte como un solo script clásico,
// dist/engine/worker.<hash>.js; la página nunca lo importa. Protocolo:
//   página → { type: 'init', wasmBinary }                  worker → { type: 'ready' } | { type: 'error', message }
//   página → { type: 'call', id, method, args }            worker → { type: 'result', id, ok, result | error }
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { createPdfium } from './pdfium.js';

const METHODS = new Set(['open', 'pageStats', 'close']);

export function createWorkerHandler(post, startRuntime = (wasmBinary) => createPdfRuntime({ wasmBinary })) {
  let engine = null;
  let starting = false;

  return async function onMessage({ data }) {
    if (data?.type === 'init') {
      if (engine || starting) return;
      starting = true;
      try {
        engine = createPdfium(await startRuntime(data.wasmBinary));
        post({ type: 'ready' });
      } catch (error) {
        post({ type: 'error', message: String(error?.message ?? error) });
      } finally {
        starting = false;
      }
      return;
    }
    if (data?.type !== 'call') return;
    const { id, method } = data;
    const args = Array.isArray(data.args) ? data.args : [];
    if (!engine) return post({ type: 'result', id, ok: false, error: { code: 'not-ready' } });
    if (!METHODS.has(method)) return post({ type: 'result', id, ok: false, error: { code: 'bad-method' } });
    try {
      post({ type: 'result', id, ok: true, result: engine[method](...args) });
    } catch (error) {
      post({ type: 'result', id, ok: false, error: { code: error?.code ?? 'error', message: String(error?.message ?? error) } });
    }
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = createWorkerHandler((message) => self.postMessage(message));
}
