// Envoltura de PDFium dentro del worker (ADR-005). Es dueña de cada puntero: lo que reserva lo libera en `finally`,
// y el único que vive entre llamadas es el de los bytes del documento abierto (PDFium los lee mientras está abierto).
// Recibe el runtime de EmbedPDF ({ fn, mem }); no sabe nada de mensajes.
import { findOccurrences, fold } from '../model/text.js';
import { fixDigitConfusions } from '../model/expediente/ocr.js';
import { toWinAnsi } from '../model/pdf/winAnsi.js';

const OBJ_TEXT = 1;
const OBJ_IMAGE = 3;
const OBJ_FORM = 5;
const MODE_INVISIBLE = 3; // modo de render 3: texto que no se pinta (la capa OCR de un escaneo)
const MAX_FORM_DEPTH = 8; // formularios anidados más hondo que esto no se recorren (archivo hostil)
const ERR_PASSWORD = 4; // FPDF_ERR_PASSWORD
const ANNOT_REDACT = 28; // FPDF_ANNOT_REDACT
const SAVE_REMOVE_SECURITY = 3; // FPDF_REMOVE_SECURITY: guardado completo y sin cifrado
const NULL = 0n; // los punteros del runtime son BigInt
const TAG_COLOR = [0, 0, 0, 255]; // negro (R3; usuario, 2026-11-24)
const OLD_TAG_COLOR = [13, 92, 74, 255]; // verde de las etiquetas de prueba anteriores: al restaurar también pasa a negro
const TAG_MIN_SCALE = 0.6; // la etiqueta se encoge para caber en el ancho del valor, hasta el 60 % (ADR-008)
const COLLATERAL_ROUNDS = 8; // vueltas máximas para añadir texto vecino que la redacción también borraría
const TAG_SLACK = 6; // puntos de holgura sobre el ancho del valor (si detrás viene un espacio no se usa: ver newTag)
const TAG = /^\[[\x21-\x5c\x5e-\x7e]{1,60}\]$/; // etiqueta [TIPO_n]: ASCII visible (Helvetica), sin «]» dentro
const MAX_NEEDLES = 5000;
const MAX_EDGE_NEEDLES = 500; // trozos de valores partidos entre folios, por página
const MAX_CONTEXT = 64;
const MAX_VALUE = 500;
const LINE_HYPHEN = 2; // PDFium da 2 por el guion «-» con que termina una línea partida (prese-/nciado)
const HYPHEN = 0x2d;

export class PdfiumFault extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PdfiumFault';
    this.code = code;
  }
}

const SOFT_HYPHEN = '\u00ad';
const HYPHENS = new Set(['-', '‐', '¬', SOFT_HYPHEN]);

// Valor de una aguja como se busca en el texto aplanado: espacios en uno, y «Juan- Pérez» (así lo deja joinText
// tras un salto de línea) como «Juan-Pérez», que es lo que flatten saca de «Juan-» / «Pérez».
const needleText = (value) => value.replace(/\s+/g, ' ').replace(/(\p{L})- (\p{Lu})/gu, '$1-$2').trim();

/**
 * Texto de la página sin saltos de línea: cada tramo de espacios (también los \r\n que genera PDFium) es un solo ' ',
 * y el guion de fin de línea se une o se quita como en joinText (layout.js): letra + guion + minúscula → palabra unida.
 * `chars`: un texto por carácter de PDFium; `lineHyphen[i]`: PDFium dio el código 2 en i (guion sin salto detrás).
 * `at[u]`: carácter de PDFium de cada unidad UTF-16 de `text`.
 * @returns {{ text: string, at: number[] }}
 */
export function flatten(chars, lineHyphen = []) {
  const isSpace = (c) => c !== undefined && /^\s+$/u.test(c);
  let text = '';
  const at = [];
  const put = (s, i) => { text += s; for (let u = 0; u < s.length; u++) at.push(i); };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    // Un guion blando dentro de una palabra (no en un salto de línea) no se ve: se quita, como en el texto que se verifica.
    if (c === SOFT_HYPHEN && i > 0 && /\p{L}$/u.test(chars[i - 1]) && chars[i + 1] !== undefined && /^\p{L}/u.test(chars[i + 1])) continue;
    if (HYPHENS.has(c) && i > 0 && /[\p{L}\p{Nd}]$/u.test(chars[i - 1])) {
      let k = i + 1;
      let broken = false;
      while (isSpace(chars[k])) { if (/[\r\n]/.test(chars[k])) broken = true; k++; }
      if (lineHyphen[i] || broken) {
        const next = chars[k];
        if (/\p{L}$/u.test(chars[i - 1]) && next !== undefined && /^\p{Ll}/u.test(next)) {
          i = k - 1; // se quita el guion y los espacios: la palabra se une
        } else {
          put(c, i);
          i = k - 1; // se queda el guion, sin los espacios de detrás
        }
        continue;
      }
    }
    if (isSpace(c)) {
      let k = i + 1;
      while (isSpace(chars[k])) k++;
      put(' ', i);
      i = k - 1;
    } else {
      put(c, i);
    }
  }
  return { text, at };
}

export function createPdfium({ fn, mem }) {
  fn.FPDF_InitLibrary();
  let doc = 0;
  let docBytes = 0;
  let poisoned = false; // una edición falló después de borrar: el documento ya no se puede guardar (ADR-008)

  function alloc(size) {
    const ptr = mem.alloc(size);
    if (!ptr) throw new PdfiumFault('too-large', `no hay memoria para ${size} bytes`);
    return ptr;
  }

  // El carácter i de la página; el guion de fin de línea vuelve a ser «-», el que está en el PDF: así se busca, se
  // vuelve a escribir y se compara (si no, la palabra se reescribiría con un código 2 que la fuente no tiene).
  function unicodeAt(textPage, i) {
    const cp = fn.FPDFText_GetUnicode(textPage, i);
    return cp === LINE_HYPHEN ? HYPHEN : cp;
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

  /**
   * Cambia en la página cada `needles[i].value` por `needles[i].put` sin mover el resto (ADR-008, opción 4).
   * Busca con las mismas reglas que la compuerta (findOccurrences: sin tildes ni mayúsculas, bordes de palabra,
   * el más largo primero, solapes descartados). Por cada objeto de texto con un valor: borra (redacción real) desde
   * el valor hasta el final de ese objeto, y lo vuelve a poner justo después del objeto en orden de lectura:
   * etiqueta (Helvetica), palabras siguientes en su propia fuente y posición, siguiente etiqueta…
   * Si algo falla después de empezar a borrar, el documento queda envenenado: editPage y save fallan con
   * 'poisoned' hasta close/open, para que nunca salga un PDF a medio editar (LayoutRefused).
   * @returns {{ replaced: number }}
   */
  function editPage(index, options) {
    requirePage(index);
    if (poisoned) throw new PdfiumFault('poisoned');
    const needles = checkNeedles(options);
    const restore = options.mode === 'restore'; // devolver valores en lugar de etiquetas (T13)
    let touched = false;
    const detached = new Set(); // objetos que no son texto, fuera de la página mientras se aplica la redacción (ADR-010)
    const page = fn.FPDF_LoadPage(doc, index);
    if (!page) throw new PdfiumFault('page', String(index));
    let textPage = 0;
    const scratch = [];
    const slot = (size) => {
      const ptr = alloc(size);
      scratch.push(ptr);
      return ptr;
    };
    try {
      textPage = fn.FPDFText_LoadPage(page);
      if (!textPage) throw new PdfiumFault('page', `texto de ${index}`);
      const d = [slot(8), slot(8), slot(8), slot(8)];
      const quad = [slot(4), slot(4), slot(4), slot(4)];
      const matrixSlot = slot(24);
      const sizeSlot = slot(4);
      const f64 = (ptr) => Number(mem.peek(ptr, 'f64'));

      const count = fn.FPDFText_CountChars(textPage);
      if (count <= 0) return { replaced: 0 };
      const objOf = new Array(count);
      const chars = new Array(count); // un texto por carácter de PDFium (dos unidades UTF-16 fuera del plano básico)
      const lineHyphen = new Uint8Array(count); // 1 donde PDFium dio el código 2 (guion de fin de línea)
      for (let i = 0; i < count; i++) {
        objOf[i] = fn.FPDFText_GetTextObject(textPage, i) || 0;
        const raw = fn.FPDFText_GetUnicode(textPage, i);
        lineHyphen[i] = raw === LINE_HYPHEN ? 1 : 0;
        const cp = raw === LINE_HYPHEN ? HYPHEN : raw;
        // Lo que no es un carácter válido no es letra ni cifra: no se une a un valor.
        chars[i] = cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '�';
      }
      // Se busca en el texto «aplanado» (un valor puede partirse entre líneas) y se vuelve a los caracteres de PDFium.
      const flat = flatten(chars, lineHyphen);
      // La compuerta también ve el texto con los 0/1 de OCR corregidos («Gl0ria» → «Gloria», mismo largo): lo que
      // solo se halla ahí también se cambia. Un hallazgo del texto crudo gana sobre uno solapado de la vista corregida.
      const fixedText = fixDigitConfusions(flat.text).text;
      const views = !restore && fixedText.length === flat.text.length && fixedText !== flat.text ? [flat.text, fixedText] : [flat.text];
      const normalList = needles.map((n, id) => ({ id, value: needleText(n.value) })).filter((n) => !needles[n.id].edge);
      const taken = new Uint8Array(flat.text.length);
      const normal = [];
      for (const view of views) {
        for (const o of findOccurrences(view, normalList)) {
          if (taken.subarray(o.start, o.end).includes(1)) continue;
          taken.fill(1, o.start, o.end);
          normal.push(o);
        }
      }
      normal.sort((a, b) => a.start - b.start);
      const flatFound = [...normal, ...(restore ? [] : edgePieces(views, flat.text, needles, normal))].sort((a, b) => a.start - b.start);
      const found = flatFound.map((o) => ({ start: flat.at[o.start], end: flat.at[o.end - 1] + 1, id: o.id }));
      if (!found.length) return { replaced: 0 };

      const topLevel = Array.from({ length: fn.FPDFPage_CountObjects(page) }, (_, i) => fn.FPDFPage_GetObject(page, i));
      const style = new Map();
      const styleOf = (obj) => {
        if (!style.has(obj)) {
          if (!fn.FPDFPageObj_GetMatrix(obj, matrixSlot) || !fn.FPDFTextObj_GetFontSize(obj, sizeSlot)) throw new PdfiumFault('font', `objeto en página ${index}`);
          if (!fn.FPDFPageObj_GetFillColor(obj, ...quad)) throw new PdfiumFault('font', `color en página ${index}`);
          const font = fn.FPDFTextObj_GetFont(obj);
          if (!font) throw new PdfiumFault('font', `fuente en página ${index}`);
          style.set(obj, {
            font,
            size: f32(sizeSlot, 0),
            matrix: [0, 4, 8, 12].map((offset) => f32(matrixSlot, offset)),
            color: quad.map((q) => Number(mem.peek(q, 'i32'))),
            mode: fn.FPDFTextObj_GetTextRenderMode(obj)
          });
        }
        return style.get(obj);
      };
      const originOf = (i) => {
        if (!fn.FPDFText_GetCharOrigin(textPage, i, d[0], d[1])) throw new PdfiumFault('page', `origen en página ${index}`);
        return [f64(d[0]), f64(d[1])];
      };
      const rectsOf = (from, to) => {
        const rects = [];
        for (let r = 0, n = fn.FPDFText_CountRects(textPage, from, to - from); r < n; r++) {
          if (!fn.FPDFText_GetRect(textPage, r, d[0], d[1], d[2], d[3])) continue;
          rects.push(d.map(f64)); // left, top, right, bottom
        }
        return rects;
      };

      const charBox = (i) => (fn.FPDFText_GetCharBox(textPage, i, d[0], d[1], d[2], d[3]) ? d.map(f64) : null); // left, right, bottom, top
      const plans = planEdits(found, objOf, count, topLevel, index, (all) => { if (restore) swallowClipped(all); swallowCollateral(all); });
      // Todo lo que se va a volver a poner se mide antes de borrar: después ya no está.
      for (const plan of plans) {
        plan.seq = [];
        let at = plan.from;
        for (const match of plan.matches) {
          pushWords(plan.seq, at, match.start);
          const first = firstObject(objOf, match.start, match.end);
          // put '' (trozo de un valor partido entre folios): se borra y no se pone etiqueta.
          if (needles[match.id].put !== '') {
            plan.seq.push({ put: needles[match.id].put, at: originOf(match.start), style: styleOf(first),
              width: extentAlong(styleOf(first).matrix, firstLine(rectsOf(match.start, match.end), index)),
              // Con un espacio detrás del valor, la etiqueta no pasa de su ancho: si no, pisa el espacio y pdf.js une la palabra siguiente.
              slack: /\s/u.test(chars[match.end] ?? ' ') ? 0 : TAG_SLACK });
          }
          at = match.end;
        }
        pushWords(plan.seq, at, plan.end);
        plan.rects = rectsOf(plan.from, plan.end);
      }
      // Restaurar: la etiqueta de protect puede ser más ancha que su valor y pisar al objeto vecino (ADR-008, TAG_SLACK):
      // el borrado lo recortaría, así que el tramo lo incluye entero y se vuelve a poner como el resto de la línea.
      function swallowClipped(plans) {
        for (let n = 0; n < plans.length; n++) {
          const plan = plans[n];
          for (let again = true; again;) {
            again = false;
            const rects = rectsOf(plan.from, plan.end);
            const lowest = Math.min(...rects.map(([, top, , bottom]) => Math.min(top, bottom)));
            for (let k = plan.end; k < count; k++) {
              if (!objOf[k] || /\s/u.test(chars[k])) continue;
              const box = charBox(k);
              if (!box) continue;
              const [left, right, bottom, top] = box;
              if (top < lowest) break; // ya en una línea más abajo
              const hit = rects.some(([l, t, r, b]) => Math.min(right, r) - Math.max(left, l) > 0 && Math.min(top, Math.max(t, b)) - Math.max(bottom, Math.min(t, b)) > 0);
              if (!hit) continue;
              let end = k;
              while (end < count && (objOf[end] === objOf[k] || !objOf[end])) end++;
              while (end > k && !objOf[end - 1]) end--;
              plan.end = end;
              again = true;
              break;
            }
          }
          while (plans[n + 1] && plans[n + 1].from < plan.end) {
            const next = plans.splice(n + 1, 1)[0];
            plan.matches.push(...next.matches);
            plan.end = Math.max(plan.end, next.end);
          }
        }
      }
      // Interlineado muy justo: el rectángulo de redacción toca glifos de la línea vecina y la redacción también los borra.
      // Esos caracteres, fuera de todo tramo, se añaden como tramos propios (sin valores) para volver a ponerlos.
      function swallowCollateral(plans) {
        for (let round = 0; round < COLLATERAL_ROUNDS; round++) {
          const covered = new Uint8Array(count);
          for (const plan of plans) covered.fill(1, plan.from, plan.end);
          const rects = plans.flatMap((plan) => rectsOf(plan.from, plan.end));
          let added = false;
          for (let k = 0; k < count; k++) {
            if (covered[k] || !objOf[k] || /\s/u.test(chars[k])) continue;
            const box = charBox(k);
            if (!box) continue;
            const [left, right, bottom, top] = box;
            const hit = rects.some(([l, t, r, b]) => Math.min(right, r) - Math.max(left, l) > 0 && Math.min(top, Math.max(t, b)) - Math.max(bottom, Math.min(t, b)) > 0);
            if (!hit) continue;
            let from = k;
            while (from > 0 && (objOf[from - 1] === objOf[k] || !objOf[from - 1])) from--;
            while (!objOf[from]) from++;
            let end = k + 1;
            while (end < count && (objOf[end] === objOf[k] || !objOf[end])) end++;
            while (end > k + 1 && !objOf[end - 1]) end--;
            plans.push({ from, end, first: objOf[from], matches: [] });
            covered.fill(1, from, end);
            added = true;
          }
          if (!added) return;
          plans.sort((a, b) => a.from - b.from);
          for (let n = 0; n < plans.length; n++) {
            const cur = plans[n];
            while (plans[n + 1] && plans[n + 1].from < cur.end) {
              const next = plans.splice(n + 1, 1)[0];
              cur.end = Math.max(cur.end, next.end);
              cur.matches.push(...next.matches);
            }
            cur.matches.sort((a, b) => a.start - b.start);
          }
        }
      }
      function pushWords(seq, from, to) {
        let word = null;
        for (let k = from; k < to; k++) {
          if (!objOf[k] || /\s/u.test(chars[k])) { word = null; continue; }
          if (!word || word.obj !== objOf[k]) {
            word = { text: '', at: originOf(k), obj: objOf[k], style: styleOf(objOf[k]) };
            seq.push(word);
          }
          const cp = unicodeAt(textPage, k);
          // Sin Unicode (glifo sin mapa) la palabra no se puede volver a escribir: se rechaza, no se recorta.
          if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) throw new PdfiumFault('font', `glifo sin Unicode en página ${index}`);
          word.text += String.fromCodePoint(cp);
        }
      }
      const inValue = new Uint8Array(count);
      for (const match of found) inValue.fill(1, match.start, match.end);
      const expected = pageChars(textPage, inValue);
      for (const match of found) for (const ch of needles[match.id].put) if (!restore || !/\s/u.test(ch)) expected.push(ch.codePointAt(0)); // pageChars no cuenta espacios
      fn.FPDFText_ClosePage(textPage);
      textPage = 0;

      const rect = slot(16);
      touched = true;
      // ADR-010: la redacción solo debe quitar texto. ApplyRedactions también corta trazos (agujero blanco en una celda
      // gris), así que todo objeto que no es texto sale de la página mientras se aplica y vuelve a su sitio después.
      for (const obj of topLevel) {
        if (fn.FPDFPageObj_GetType(obj) === OBJ_TEXT) continue;
        if (!fn.FPDFPage_RemoveObject(page, obj)) throw new PdfiumFault('redact', `página ${index}`);
        detached.add(obj);
      }
      for (const plan of plans) {
        for (const [left, top, right, bottom] of plan.rects) {
          const annot = fn.FPDFPage_CreateAnnot(page, ANNOT_REDACT);
          if (!annot) throw new PdfiumFault('redact', `página ${index}`);
          try {
            [left, top, right, bottom].forEach((value, i) => mem.poke(rect, 'f32', value, i * 4));
            if (!fn.FPDFAnnot_SetRect(annot, rect)) throw new PdfiumFault('redact', `página ${index}`);
          } finally {
            fn.FPDFPage_CloseAnnot(annot);
          }
        }
      }
      const applied = slot(8);
      if (!fn.EPDFPage_ApplyRedactions(page, NULL, 0, applied)) throw new PdfiumFault('redact', `página ${index}`);

      // Se devuelven en su orden original; el texto que sobrevive conserva sus punteros y su orden relativo, y el
      // que la redacción borró entero simplemente se salta.
      let slotAt = 0;
      for (const obj of topLevel) {
        if (detached.has(obj)) {
          if (!fn.FPDFPage_InsertObjectAtIndex(page, obj, slotAt)) throw new PdfiumFault('redact', `página ${index}`);
          detached.delete(obj); // ya es de la página otra vez
          slotAt++;
        } else if (fn.FPDFPage_GetObject(page, slotAt) === obj) slotAt++;
      }
      const objectsNow = () => Array.from({ length: fn.FPDFPage_CountObjects(page) }, (_, i) => fn.FPDFPage_GetObject(page, i));
      // La redacción solo quita objetos o los recorta; si crea uno, un ancla podría ser otro objeto con la misma
      // dirección: se rechaza la página.
      const original = new Set(topLevel);
      if (objectsNow().some((obj) => !original.has(obj))) throw new PdfiumFault('anchor', `página ${index}`);
      const inserted = new Set();
      let replaced = 0;
      // En el orden del flujo, no del texto: un tramo que va antes en el flujo inserta antes, y uno que comparte
      // ancla con él queda después de lo suyo.
      for (const plan of [...plans].sort((x, y) => x.position - y.position || x.from - y.from)) {
        const list = objectsNow();
        const alive = new Set(list.filter((obj) => !inserted.has(obj))); // lo insertado nunca es ancla
        // El ancla es el objeto del valor si le quedó su comienzo; si no, el más cercano anterior que siga vivo.
        // Si todos los anteriores se borraron enteros, el sitio correcto es el comienzo de la página.
        if (plan.keepsHead && !alive.has(plan.first)) throw new PdfiumFault('anchor', `página ${index}`);
        const anchor = plan.anchors.find((obj) => alive.has(obj));
        let at = anchor === undefined ? 0 : list.indexOf(anchor) + 1;
        while (at < list.length && inserted.has(list[at])) at++; // después de lo insertado para una línea anterior
        for (const item of plan.seq) {
          const obj = item.put === undefined ? newWord(item) : newTag(item);
          if (!fn.FPDFPage_InsertObjectAtIndex(page, obj, at)) {
            fn.FPDFPageObj_Destroy(obj);
            throw new PdfiumFault('insert', `página ${index}`);
          }
          at++;
          inserted.add(obj);
          if (item.put !== undefined) replaced++;
        }
      }
      if (!fn.FPDFPage_GenerateContent(page)) throw new PdfiumFault('generate', `página ${index}`);
      textPage = fn.FPDFText_LoadPage(page);
      if (!textPage) throw new PdfiumFault('page', `texto de ${index}`);
      // Lo que queda en la página debe ser, carácter por carácter (sin orden ni espacios), lo de antes menos los
      // valores más las etiquetas: una redacción que tocó una línea vecina falla aquí, no en silencio.
      if (!sameChars(pageChars(textPage), expected)) throw new PdfiumFault('lost-text', `página ${index}`);
      return { replaced };

      function newTag(item) {
        const obj = fn.FPDFPageObj_NewTextObj(doc, 'Helvetica', item.style.size);
        if (!obj) throw new PdfiumFault('font', 'Helvetica');
        try {
          setText(obj, item.put);
          if (!fn.FPDFPageObj_GetBounds(obj, ...quad)) throw new PdfiumFault('font', 'medida de etiqueta');
          const [a, b, c, dd] = item.style.matrix;
          // Ancho natural de la etiqueta en la página: medida sin transformar × la escala de la matriz en la dirección
          // del texto (Word pone el tamaño en Tf; LibreOffice, iText o ReportLab a menudo en la matriz).
          const natural = (Math.abs(f32(quad[2], 0) - f32(quad[0], 0)) * Math.hypot(a, b)) || 1;
          const k = Math.max(TAG_MIN_SCALE, Math.min(1, (item.width + item.slack) / natural));
          fn.FPDFPageObj_Transform(obj, k * a, k * b, k * c, k * dd, item.at[0], item.at[1]);
          // Restaurar: el valor lleva el color del texto que cubre; el verde de etiquetas anteriores pasa a negro.
          const own = item.style.color;
          const color = !restore ? TAG_COLOR : own.every((v, i) => v === OLD_TAG_COLOR[i]) ? TAG_COLOR : own;
          if (!fn.FPDFPageObj_SetFillColor(obj, ...color)) throw new PdfiumFault('font', 'color de etiqueta');
          if (!fn.FPDFTextObj_SetTextRenderMode(obj, item.style.mode)) throw new PdfiumFault('font', 'modo de etiqueta');
          return obj;
        } catch (error) {
          fn.FPDFPageObj_Destroy(obj);
          throw error;
        }
      }

      function newWord(item) {
        const obj = fn.FPDFPageObj_CreateTextObj(doc, item.style.font, item.style.size);
        if (!obj) throw new PdfiumFault('font', 'palabra');
        try {
          setText(obj, item.text); // fuente sin mapa Unicode (Type 3…): falla aquí, nunca una palabra que falte
          fn.FPDFPageObj_Transform(obj, ...item.style.matrix, item.at[0], item.at[1]);
          if (!fn.FPDFPageObj_SetFillColor(obj, ...item.style.color)) throw new PdfiumFault('font', 'color de palabra');
          if (!fn.FPDFTextObj_SetTextRenderMode(obj, item.style.mode)) throw new PdfiumFault('font', 'modo de palabra');
          return obj;
        } catch (error) {
          fn.FPDFPageObj_Destroy(obj);
          throw error;
        }
      }

      function setText(obj, value) {
        const ptr = mem.writeU16String(value);
        try {
          if (!fn.FPDFText_SetText(obj, ptr)) throw new PdfiumFault('font', 'texto sin glifos en la fuente');
        } finally {
          mem.free(ptr);
        }
      }
    } catch (error) {
      if (touched) poisoned = true;
      for (const obj of detached) fn.FPDFPageObj_Destroy(obj); // sin volver a la página: nadie más los libera
      throw error;
    } finally {
      for (const ptr of scratch) mem.free(ptr);
      if (textPage) fn.FPDFText_ClosePage(textPage);
      fn.FPDF_ClosePage(page);
    }
  }

  // Caracteres de la página que no son espacios ni generados por PDFium; `skip[i]` los deja fuera.
  function pageChars(textPage, skip) {
    const out = [];
    for (let i = 0, n = fn.FPDFText_CountChars(textPage); i < n; i++) {
      if (skip?.[i] || fn.FPDFText_IsGenerated(textPage, i) === 1) continue;
      const cp = unicodeAt(textPage, i);
      if (cp > 0 && cp <= 0x10ffff && /\s/u.test(String.fromCodePoint(cp))) continue;
      out.push(cp);
    }
    return out;
  }

  /** El documento abierto, guardado entero y sin cifrado (flag 3, ADR-007). */
  function save() {
    if (!doc) throw new PdfiumFault('no-document');
    if (poisoned) throw new PdfiumFault('poisoned');
    const sizeSlot = alloc(8);
    let out = 0;
    try {
      out = fn.EPDF_SaveDocumentToOwnedBuffer(doc, SAVE_REMOVE_SECURITY, sizeSlot);
      if (!out) throw new PdfiumFault('save');
      const size = Number(mem.peek(sizeSlot, 'i32')) >>> 0;
      if (!size) throw new PdfiumFault('save', 'vacío');
      return mem.readBytes(out, size).slice();
    } finally {
      if (out) fn.EPDF_FreeBuffer(out);
      mem.free(sizeSlot);
    }
  }

  function close() {
    if (doc) fn.FPDF_CloseDocument(doc);
    if (docBytes) mem.free(docBytes);
    doc = 0;
    docBytes = 0;
    poisoned = false;
  }

  return { open, pageStats, editPage, save, close };
}

function checkNeedles(options) {
  if (options?.mode !== 'protect' && options?.mode !== 'restore') throw new PdfiumFault('bad-input', 'mode');
  const { needles } = options;
  if (options.mode === 'restore') return checkRestoreNeedles(needles);
  if (!Array.isArray(needles)) throw new PdfiumFault('bad-input', 'needles');
  const edges = needles.filter((n) => n?.edge !== undefined).length;
  if (needles.length - edges > MAX_NEEDLES || edges > MAX_EDGE_NEEDLES) throw new PdfiumFault('bad-input', 'needles');
  for (const needle of needles) {
    if (typeof needle?.value !== 'string' || !needle.value.trim() || needle.value.length > MAX_VALUE) throw new PdfiumFault('bad-input', 'value');
    if (needle.edge !== undefined && needle.edge !== 'end' && needle.edge !== 'start') throw new PdfiumFault('bad-input', 'edge');
    if (needle.context !== undefined && (needle.edge === undefined || typeof needle.context !== 'string' || needle.context.length > MAX_CONTEXT)) throw new PdfiumFault('bad-input', 'context');
    const bare = needle.edge !== undefined && needle.put === ''; // trozo de un valor partido entre folios: sin etiqueta
    if (typeof needle.put !== 'string' || !(bare || TAG.test(needle.put))) throw new PdfiumFault('bad-input', 'put');
  }
  return needles;
}

// Restaurar (T13): la aguja es una etiqueta conocida y `put` el valor real, en WinAnsi y en una sola línea.
function checkRestoreNeedles(needles) {
  if (!Array.isArray(needles) || needles.length > MAX_NEEDLES) throw new PdfiumFault('bad-input', 'needles');
  for (const needle of needles) {
    if (typeof needle?.value !== 'string' || !TAG.test(needle.value)) throw new PdfiumFault('bad-input', 'value');
    if (needle.edge !== undefined) throw new PdfiumFault('bad-input', 'edge');
    if (needle.context !== undefined) throw new PdfiumFault('bad-input', 'context');
    const { put } = needle;
    if (typeof put !== 'string' || !put || put.length > MAX_VALUE || /[\r\n]/.test(put) || toWinAnsi(put).text !== put) throw new PdfiumFault('bad-input', 'put');
  }
  return needles;
}

// Texto para comparar contextos: plegado como findOccurrences, sin ningún espacio ni guion blando (los saltos de
// línea y espacios del texto del párrafo y de la página no coinciden).
const squash = (text) => fold(text).replace(/[\s\u00ad]/gu, '');

/**
 * Trozos de un valor partido entre folios (needles con `edge`), en coordenadas del texto aplanado: solo en lo que
 * no tomó una aguja normal. Un hallazgo cuenta solo si el texto de al lado coincide con `context` (el del párrafo
 * unido): para 'end', lo que va antes del hallazgo termina con el contexto; para 'start', lo que va después lo empieza.
 * Así un encabezado o una firma con el mismo nombre no se borra en lugar del trozo pegado al salto de folio.
 * 'end' toma el ÚLTIMO hallazgo que cuenta (y el guion de fin de página que lo sigue, como «Rí-»); 'start' el PRIMERO.
 * Sin ninguno no se borra nada: la verificación lo rechazará.
 */
function edgePieces(views, text, needles, taken) {
  const used = new Uint8Array(text.length);
  for (const o of taken) used.fill(1, o.start, o.end);
  const out = [];
  needles.forEach((needle, id) => {
    if (!needle.edge) return;
    const context = squash(needle.context ?? '');
    let hit;
    for (const view of views) { // el texto crudo primero; el corregido solo si allí no hay hallazgo que cuente
      const hits = findOccurrences(view, [{ id, value: needleText(needle.value) }]).filter((o) => {
        if (used.subarray(o.start, o.end).includes(1)) return false;
        if (!context) return true;
        return needle.edge === 'end' ? squash(view.slice(0, o.start)).endsWith(context) : squash(view.slice(o.end)).startsWith(context);
      });
      hit = needle.edge === 'end' ? hits.at(-1) : hits[0];
      if (hit) break;
    }
    if (!hit) return;
    let { end } = hit;
    // El guion de fin de línea pegado al trozo («Rí-»): flatten lo deja junto a la palabra aunque detrás venga el pie de página.
    if (needle.edge === 'end' && HYPHENS.has(text[end]) && !used[end]) end += 1;
    used.fill(1, hit.start, end);
    out.push({ start: hit.start, end, id });
  });
  return out;
}

function firstObject(objOf, from, to) {
  for (let k = from; k < to; k++) if (objOf[k]) return objOf[k];
  return 0;
}

/**
 * Agrupa los hallazgos en tramos [from, end): desde el valor hasta el final del último objeto que toca, y une
 * los hallazgos que caen dentro del mismo tramo. Cada tramo lleva sus anclas: el objeto del valor si conserva
 * su comienzo, luego los objetos anteriores de la página, del más cercano al más lejano.
 */
function planEdits(found, objOf, count, topLevel, index, extend) {
  const plans = [];
  const isTopLevel = new Set(topLevel);
  for (const match of found) {
    const first = firstObject(objOf, match.start, match.end);
    if (!first) throw new PdfiumFault('page', `valor sin objeto en página ${index}`);
    let last = first;
    for (let k = match.end - 1; k >= match.start; k--) if (objOf[k]) { last = objOf[k]; break; }
    let end = match.end;
    while (end < count && (objOf[end] === last || !objOf[end])) end++;
    while (end > match.end && !objOf[end - 1]) end--; // los espacios generados del final no son del objeto
    const current = plans.at(-1);
    if (current && match.start < current.end) {
      current.matches.push(match);
      current.end = Math.max(current.end, end);
      continue;
    }
    plans.push({ from: match.start, end, first, matches: [match] });
  }
  extend?.(plans);
  const erased = new Uint8Array(count);
  for (const plan of plans) erased.fill(1, plan.from, plan.end);
  for (const plan of plans) {
    for (let k = plan.from; k < plan.end; k++) {
      // Texto dentro de un formulario (XObject): no hay dónde insertar en orden en la página.
      if (objOf[k] && !isTopLevel.has(objOf[k])) throw new PdfiumFault('nested', `página ${index}`);
    }
    const position = topLevel.indexOf(plan.first);
    plan.position = position;
    const before = topLevel.slice(0, position).reverse();
    // Le queda comienzo si algún carácter suyo anterior al tramo no lo borra otro tramo.
    let keepsHead = false;
    for (let k = 0; k < plan.from && !keepsHead; k++) keepsHead = objOf[k] === plan.first && !erased[k];
    plan.keepsHead = keepsHead;
    plan.anchors = keepsHead ? [plan.first, ...before] : before;
  }
  return plans;
}


function sameChars(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.every((v, i) => v === y[i]);
}

/** Largo de unas cajas de página (left, top, right, bottom) en la dirección del texto (a, b) de la matriz. */
function extentAlong([a, b], rects) {
  const norm = Math.hypot(a, b) || 1;
  const [ux, uy] = [Math.abs(a / norm), Math.abs(b / norm)];
  return rects.reduce((sum, [left, top, right, bottom]) => sum + ux * Math.abs(right - left) + uy * Math.abs(top - bottom), 0);
}

/**
 * Las cajas de la primera línea del valor: la etiqueta va en esa línea, así que su ancho manda (un valor partido
 * en dos líneas no le presta el ancho de la segunda). Sin ninguna caja no hay medida: se rechaza la página.
 */
function firstLine(rects, index) {
  if (!rects.length) throw new PdfiumFault('page', `valor sin caja en página ${index}`);
  const [, top0, , bottom0] = rects[0];
  const [low0, high0] = [Math.min(top0, bottom0), Math.max(top0, bottom0)];
  return rects.filter(([, top, , bottom]) => {
    const overlap = Math.min(high0, Math.max(top, bottom)) - Math.max(low0, Math.min(top, bottom));
    return overlap > 0.5 * (high0 - low0);
  });
}
