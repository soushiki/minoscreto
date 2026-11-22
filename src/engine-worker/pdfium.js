// Envoltura de PDFium dentro del worker (ADR-005). Es dueña de cada puntero: lo que reserva lo libera en `finally`,
// y el único que vive entre llamadas es el de los bytes del documento abierto (PDFium los lee mientras está abierto).
// Recibe el runtime de EmbedPDF ({ fn, mem }); no sabe nada de mensajes.
import { findOccurrences } from '../model/text.js';

const OBJ_TEXT = 1;
const OBJ_IMAGE = 3;
const OBJ_FORM = 5;
const MODE_INVISIBLE = 3; // modo de render 3: texto que no se pinta (la capa OCR de un escaneo)
const MAX_FORM_DEPTH = 8; // formularios anidados más hondo que esto no se recorren (archivo hostil)
const ERR_PASSWORD = 4; // FPDF_ERR_PASSWORD
const ANNOT_REDACT = 28; // FPDF_ANNOT_REDACT
const SAVE_REMOVE_SECURITY = 3; // FPDF_REMOVE_SECURITY: guardado completo y sin cifrado
const NULL = 0n; // los punteros del runtime son BigInt
const TAG_COLOR = [13, 92, 74, 255]; // verde oscuro de la marca, como en el PDF de texto
const TAG_MIN_SCALE = 0.6; // la etiqueta se encoge para caber en el ancho del valor, hasta el 60 % (ADR-008)
const TAG_SLACK = 6; // puntos de holgura sobre el ancho del valor
const TAG = /^\[[\x21-\x5c\x5e-\x7e]{1,60}\]$/; // etiqueta [TIPO_n]: ASCII visible (Helvetica), sin «]» dentro
const MAX_NEEDLES = 5000;
const MAX_VALUE = 500;

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
  let poisoned = false; // una edición falló después de borrar: el documento ya no se puede guardar (ADR-008)

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
    let touched = false;
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
      let text = '';
      for (let i = 0; i < count; i++) {
        objOf[i] = fn.FPDFText_GetTextObject(textPage, i) || 0;
        const cp = fn.FPDFText_GetUnicode(textPage, i);
        // Una unidad UTF-16 por carácter de PDFium, para que las posiciones coincidan; lo que no cabe no es letra ni cifra.
        text += cp > 0 && cp <= 0xffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCharCode(cp) : '�';
      }
      const found = findOccurrences(text, needles.map((n, id) => ({ id, value: n.value })));
      if (!found.length) return { replaced: 0 };

      const topLevel = Array.from({ length: fn.FPDFPage_CountObjects(page) }, (_, i) => fn.FPDFPage_GetObject(page, i));
      const plans = planEdits(found, objOf, count, topLevel, index);
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

      // Todo lo que se va a volver a poner se mide antes de borrar: después ya no está.
      for (const plan of plans) {
        plan.seq = [];
        let at = plan.from;
        for (const match of plan.matches) {
          pushWords(plan.seq, at, match.start);
          const first = firstObject(objOf, match.start, match.end);
          plan.seq.push({ put: needles[match.id].put, at: originOf(match.start), style: styleOf(first),
            width: rectsOf(match.start, match.end).reduce((sum, [left, , right]) => sum + Math.abs(right - left), 0) });
          at = match.end;
        }
        pushWords(plan.seq, at, plan.end);
        plan.rects = rectsOf(plan.from, plan.end);
      }
      function pushWords(seq, from, to) {
        let word = null;
        for (let k = from; k < to; k++) {
          if (!objOf[k] || /\s/u.test(text[k])) { word = null; continue; }
          if (!word || word.obj !== objOf[k]) {
            word = { text: '', at: originOf(k), obj: objOf[k], style: styleOf(objOf[k]) };
            seq.push(word);
          }
          const cp = fn.FPDFText_GetUnicode(textPage, k);
          // Sin Unicode (glifo sin mapa) la palabra no se puede volver a escribir: se rechaza, no se recorta.
          if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) throw new PdfiumFault('font', `glifo sin Unicode en página ${index}`);
          word.text += String.fromCodePoint(cp);
        }
      }
      const inValue = new Uint8Array(count);
      for (const match of found) inValue.fill(1, match.start, match.end);
      const expected = pageChars(textPage, inValue);
      for (const match of found) for (const ch of needles[match.id].put) expected.push(ch.codePointAt(0));
      fn.FPDFText_ClosePage(textPage);
      textPage = 0;

      const rect = slot(16);
      touched = true;
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

      const objectsNow = () => Array.from({ length: fn.FPDFPage_CountObjects(page) }, (_, i) => fn.FPDFPage_GetObject(page, i));
      // La redacción solo quita objetos o los recorta; si crea uno, un ancla podría ser otro objeto con la misma
      // dirección: se rechaza la página.
      const original = new Set(topLevel);
      if (objectsNow().some((obj) => !original.has(obj))) throw new PdfiumFault('anchor', `página ${index}`);
      const inserted = new Set();
      let replaced = 0;
      for (const plan of plans) {
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
          const natural = Math.abs(f32(quad[2], 0) - f32(quad[0], 0)) || 1;
          const k = Math.max(TAG_MIN_SCALE, Math.min(1, (item.width + TAG_SLACK) / natural));
          const [a, b, c, dd] = item.style.matrix;
          fn.FPDFPageObj_Transform(obj, k * a, k * b, k * c, k * dd, item.at[0], item.at[1]);
          if (!fn.FPDFPageObj_SetFillColor(obj, ...TAG_COLOR)) throw new PdfiumFault('font', 'color de etiqueta');
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
      const cp = fn.FPDFText_GetUnicode(textPage, i);
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
  if (options?.mode !== 'protect') throw new PdfiumFault('bad-input', 'mode');
  const { needles } = options;
  if (!Array.isArray(needles) || needles.length > MAX_NEEDLES) throw new PdfiumFault('bad-input', 'needles');
  for (const needle of needles) {
    if (typeof needle?.value !== 'string' || !needle.value.trim() || needle.value.length > MAX_VALUE) throw new PdfiumFault('bad-input', 'value');
    if (typeof needle.put !== 'string' || !TAG.test(needle.put)) throw new PdfiumFault('bad-input', 'put');
  }
  return needles;
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
function planEdits(found, objOf, count, topLevel, index) {
  const plans = [];
  const isTopLevel = new Set(topLevel);
  const firstSeen = new Map(); // primer carácter de cada objeto en el texto de la página
  objOf.forEach((obj, k) => { if (obj && !firstSeen.has(obj)) firstSeen.set(obj, k); });
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
  for (const plan of plans) {
    for (let k = plan.from; k < plan.end; k++) {
      // Texto dentro de un formulario (XObject): no hay dónde insertar en orden en la página.
      if (objOf[k] && !isTopLevel.has(objOf[k])) throw new PdfiumFault('nested', `página ${index}`);
    }
    const position = topLevel.indexOf(plan.first);
    const before = topLevel.slice(0, position).reverse();
    const keepsHead = firstSeen.get(plan.first) < plan.from;
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
