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

/** Lee todas las páginas: [{ number, lines }]. Llama a onProgress(hechas, total) y respeta signal.aborted. */
export async function readPdfPages(data, { onProgress, signal } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: true, disableAutoFetch: true, disableStream: true, verbosity: 0
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
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
    return pages;
  } finally {
    task.destroy();
  }
}
