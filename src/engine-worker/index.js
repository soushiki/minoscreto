// Worker del motor PDFium (ADR-004/005). El build lo empaqueta aparte como un solo script clásico,
// dist/engine/worker.<hash>.js; la página nunca lo importa. Por ahora solo arranca el motor (T4 añade el resto).
import { createPdfRuntime } from '@embedpdf/engine-runtime';

let runtime = null;

self.onmessage = async ({ data }) => {
  if (data?.type !== 'init' || runtime) return;
  try {
    runtime = await createPdfRuntime({ wasmBinary: data.wasmBinary });
    self.postMessage({ type: 'ready' });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error?.message ?? error) });
  }
};
