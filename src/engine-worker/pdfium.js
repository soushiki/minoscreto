// Envoltura de PDFium dentro del worker (ADR-005). Es dueña de cada puntero: lo que reserva lo libera en `finally`,
// y el único que vive entre llamadas es el de los bytes del documento abierto (PDFium los lee mientras está abierto).
// Recibe el runtime de EmbedPDF ({ fn, mem }); no sabe nada de mensajes.

const OBJ_TEXT = 1;
const OBJ_IMAGE = 3;
const OBJ_FORM = 5;
const MODE_INVISIBLE = 3; // modo de render 3: texto que no se pinta (la capa OCR de un escaneo)
const MAX_FORM_DEPTH = 8; // formularios anidados más hondo que esto no se recorren (archivo hostil)
const ERR_PASSWORD = 4; // FPDF_ERR_PASSWORD

export class PdfiumFault extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PdfiumFault';
    this.code = code;
  }
}

export function createPdfium({ fn, mem }) {
  fn.FPDF_InitLibrary();
  let doc = 0;
  let docBytes = 0;

  function alloc(size) {
    const ptr = mem.alloc(size);
    if (!ptr) throw new PdfiumFault('too-large', `no hay memoria para ${size} bytes`);
    return ptr;
  }

  function requirePage(index) {
    if (!doc) throw new PdfiumFault('no-document');
    if (!Number.isInteger(index) || index < 0 || index >= fn.FPDF_GetPageCount(doc)) throw new PdfiumFault('bad-page', String(index));
  }

  /** Abre el PDF. `password` se usa solo aquí y no se guarda (ADR-007). */
  function open(bytes, password = '') {
    // toString en vez de instanceof: vale también para un Uint8Array de otro realm.
    if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]' || bytes.length === 0) throw new PdfiumFault('bad-input');
    if (typeof password !== 'string') throw new PdfiumFault('bad-input', 'password');
    close();
    const ptr = alloc(bytes.length);
    try {
      mem.writeBytes(ptr, bytes);
      const opened = fn.FPDF_LoadMemDocument64(ptr, bytes.length, password);
      if (!opened) {
        const error = fn.FPDF_GetLastError();
        throw new PdfiumFault(error === ERR_PASSWORD ? 'password' : 'open', `PDFium ${error}`);
      }
      doc = opened;
      docBytes = ptr;
      return { pageCount: fn.FPDF_GetPageCount(doc) };
    } finally {
      if (docBytes !== ptr) mem.free(ptr);
    }
  }

  /**
   * Señales para decidir si la página es un escaneo (R5, scan.js):
   * visibleChars / invisibleChars = caracteres no blancos en texto pintado / en modo 3;
   * imageCoverage = fracción de la página (0–1) que cubre la imagen más grande; hasImages.
   */
  function pageStats(index) {
    requirePage(index);
    const page = fn.FPDF_LoadPage(doc, index);
    if (!page) throw new PdfiumFault('page', String(index));
    let textPage = 0;
    let rect = 0;
    let matrix = 0;
    const slots = [];
    try {
      rect = alloc(16);
      for (let i = 0; i < 4; i++) slots.push(alloc(4));
      textPage = fn.FPDFText_LoadPage(page);
      if (!textPage) throw new PdfiumFault('page', `texto de ${index}`);
      if (!fn.FPDF_GetPageBoundingBox(page, rect)) throw new PdfiumFault('page', `caja de ${index}`);
      const box = { left: f32(rect, 0), top: f32(rect, 4), right: f32(rect, 8), bottom: f32(rect, 12) };
      const pageArea = Math.abs((box.right - box.left) * (box.top - box.bottom));
      const stats = { visibleChars: 0, invisibleChars: 0, imageCoverage: 0, hasImages: false };
      matrix = alloc(24);
      const coverOf = (obj, toPage) => (pageArea > 0 ? clippedArea(obj, toPage, box, slots) / pageArea : 0);
      walk(fn.FPDFPage_CountObjects(page), (i) => fn.FPDFPage_GetObject(page, i), 0, null);
      return stats;

      // `toPage`: matriz del espacio del formulario que contiene al objeto a la página (null = ya en la página).
      // La caja de un objeto dentro de un formulario está en el espacio del formulario, no de la página.
      function walk(count, get, depth, toPage) {
        for (let i = 0; i < count; i++) {
          const obj = get(i);
          if (!obj) continue;
          const type = fn.FPDFPageObj_GetType(obj);
          if (type === OBJ_TEXT) {
            const chars = countChars(obj, textPage);
            if (fn.FPDFTextObj_GetTextRenderMode(obj) === MODE_INVISIBLE) stats.invisibleChars += chars;
            else stats.visibleChars += chars;
          } else if (type === OBJ_IMAGE) {
            stats.hasImages = true;
            stats.imageCoverage = Math.max(stats.imageCoverage, coverOf(obj, toPage));
          } else if (type === OBJ_FORM && depth < MAX_FORM_DEPTH) {
            if (!fn.FPDFPageObj_GetMatrix(obj, matrix)) continue;
            const own = [0, 4, 8, 12, 16, 20].map((offset) => f32(matrix, offset));
            walk(fn.FPDFFormObj_CountObjects(obj), (j) => fn.FPDFFormObj_GetObject(obj, j), depth + 1, toPage ? compose(toPage, own) : own);
          }
        }
      }
    } finally {
      for (const slot of slots) mem.free(slot);
      if (matrix) mem.free(matrix);
      if (rect) mem.free(rect);
      if (textPage) fn.FPDFText_ClosePage(textPage);
      fn.FPDF_ClosePage(page);
    }
  }

  function countChars(obj, textPage) {
    const size = fn.FPDFTextObj_GetText(obj, textPage, 0, 0); // bytes UTF-16 con el NUL final
    if (size <= 2) return 0;
    const buffer = alloc(size);
    try {
      fn.FPDFTextObj_GetText(obj, textPage, buffer, size);
      return mem.readU16String(buffer).replace(/\s/gu, '').length;
    } finally {
      mem.free(buffer);
    }
  }

  // FPDFPageObj_GetBounds escribe left, bottom, right, top (float); se recorta a la caja visible de la página.
  // `slots`: cuatro reservas de 4 bytes (los punteros pueden ser BigInt: no se suman offsets).
  function clippedArea(obj, toPage, box, slots) {
    if (!fn.FPDFPageObj_GetBounds(obj, ...slots)) return 0;
    let [left, bottom, right, top] = slots.map((slot) => f32(slot, 0));
    if (toPage) {
      const corners = [[left, bottom], [right, bottom], [left, top], [right, top]].map(([x, y]) => apply(toPage, x, y));
      [left, right] = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))];
      [bottom, top] = [Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[1]))];
    }
    const width = Math.min(right, Math.max(box.left, box.right)) - Math.max(left, Math.min(box.left, box.right));
    const height = Math.min(top, Math.max(box.top, box.bottom)) - Math.max(bottom, Math.min(box.top, box.bottom));
    return width > 0 && height > 0 ? width * height : 0;
  }

  // Matrices PDF [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
  function apply([a, b, c, d, e, f], x, y) {
    return [a * x + c * y + e, b * x + d * y + f];
  }

  function compose(outer, [a, b, c, d, e, f]) {
    const [p, q] = apply(outer, e, f);
    return [outer[0] * a + outer[2] * b, outer[1] * a + outer[3] * b, outer[0] * c + outer[2] * d, outer[1] * c + outer[3] * d, p, q];
  }

  function f32(ptr, offset) {
    return Number(mem.peek(ptr, 'f32', offset));
  }

  function close() {
    if (doc) fn.FPDF_CloseDocument(doc);
    if (docBytes) mem.free(docBytes);
    doc = 0;
    docBytes = 0;
  }

  return { open, pageStats, close };
}
