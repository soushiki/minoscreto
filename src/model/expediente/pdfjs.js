// Lectura de la capa de texto de un PDF con pdf.js, en el navegador. pdf.js y su worker van dentro del
// mismo index.html (worker en línea) y se cargan solo al abrir el primer PDF. No hace ninguna petición de red.
import { itemsToLines } from './layout.js';

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline')
    ]).then(([pdfjs, { default: PdfWorker }]) => {
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export class PdfError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Espera la respuesta de askPassword; si signal se cancela antes, responde null sin esperar al diálogo.
function waitForPassword(askPassword, request, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }
    const onAbort = () => resolve(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => askPassword(request))
      .then((answer) => resolve(typeof answer === 'string' ? answer : null), () => resolve(null))
      .finally(() => signal?.removeEventListener('abort', onAbort));
  });
}

/**
 * Lee todas las páginas: [{ number, lines }]. Llama a onProgress(hechas, total) y respeta signal.aborted.
 * Si el PDF pide contraseña y hay askPassword({ fileName, reason: 'need'|'incorrect', signal }), la contraseña
 * se pasa a updatePassword en la misma tarea de pdf.js y no se guarda en ningún otro lado (ADR-002).
 * askPassword → null: PdfError 'cancelled'. Sin askPassword: PdfError 'password', como antes.
 */
export async function readPdfPages(data, { askPassword, fileName = '', onProgress, signal } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: true, disableAutoFetch: true, disableStream: true, verbosity: 0
  });
  let cancelled = false;
  if (askPassword) {
    const incorrect = pdfjs.PasswordResponses?.INCORRECT_PASSWORD ?? 2;
    task.onPassword = (updatePassword, code) => {
      const reason = code === incorrect ? 'incorrect' : 'need';
      waitForPassword(askPassword, { fileName, reason, signal }, signal).then((answer) => {
        if (answer === null || signal?.aborted) {
          cancelled = true;
          updatePassword(new Error('cancelled'));
        } else {
          updatePassword(answer);
        }
      });
    };
  }
  // Cancelar la lectura detiene pdf.js también después de la contraseña (task.promise rechaza → 'aborted').
  const stopOnAbort = () => { task.destroy().catch(() => {}); };
  signal?.addEventListener('abort', stopOnAbort, { once: true });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    task.destroy().catch(() => {});
    signal?.removeEventListener('abort', stopOnAbort);
    if (signal?.aborted) throw new PdfError('Lectura cancelada.', 'aborted');
    if (cancelled) throw new PdfError('No se abrió el PDF: se canceló la contraseña.', 'cancelled');
    if (error?.name === 'PasswordException') throw new PdfError('El PDF está protegido con contraseña.', 'password');
    throw new PdfError('No se pudo leer el PDF.', 'invalid');
  }
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (signal?.aborted) throw new PdfError('Lectura cancelada.', 'aborted');
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push({ number: n, lines: itemsToLines(content.items) });
      page.cleanup();
      onProgress?.(n, pdf.numPages);
    }
    // Una cancelación durante la última página no devuelve una lectura cancelada.
    if (signal?.aborted) throw new PdfError('Lectura cancelada.', 'aborted');
    return pages;
  } catch (error) {
    if (signal?.aborted) throw new PdfError('Lectura cancelada.', 'aborted');
    throw error;
  } finally {
    signal?.removeEventListener('abort', stopOnAbort);
    task.destroy().catch(() => {});
  }
}
