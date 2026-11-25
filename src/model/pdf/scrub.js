// Limpieza del PDF con formato (S7, ADR-001 enmendado): quita metadatos, anotaciones, formularios, índice,
// adjuntos, JavaScript, acciones, estructura y revisiones anteriores, y guarda sin flujos de objetos.
// listTextualObjects da al control final (verify.js) cada cadena y cada flujo decodificado del archivo.
// pdf-lib se carga solo con import() dinámico.

// Lista blanca: cualquier otra clave del catálogo o de la página se quita (metadatos, formularios, índice,
// adjuntos, JavaScript, acciones, estructura, datos privados, claves raras de cada productor).
export const ALLOWED_CATALOG_KEYS = Object.freeze([
  'Type', 'Pages', 'Version', 'Extensions', 'PageLabels', 'PageLayout', 'ViewerPreferences', 'Lang', 'OCProperties',
]);
export const ALLOWED_PAGE_KEYS = Object.freeze([
  'Type', 'Parent', 'Kids', 'Count', 'Resources', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox',
  'BoxColorInfo', 'Contents', 'Rotate', 'Group', 'UserUnit',
]);
// Claves que se quitan de cualquier diccionario alcanzable (XMP de imágenes y fuentes, datos de la aplicación).
const FORBIDDEN_ANYWHERE = Object.freeze(['Metadata', 'PieceInfo']);
// Filtros que pdf-lib decodifica; un flujo con otro filtro (imágenes DCT/JPX/JBIG2/CCITT) va a `undecoded`.
const DECODABLE = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']);

const loadLib = () => import('pdf-lib');

async function loadDoc(lib, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new TypeError('scrub: bytes must be a non-empty Uint8Array');
  // updateMetadata:false: pdf-lib no crea un diccionario Info propio.
  return lib.PDFDocument.load(bytes, { updateMetadata: false });
}

// Recorre todo lo alcanzable desde la raíz; visit(obj) se llama una vez por objeto directo o indirecto.
function walkReachable(lib, ctx, root, visit) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const seenRefs = new Set();
  const stack = [root];
  while (stack.length) {
    let obj = stack.pop();
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (seenRefs.has(key)) continue;
      seenRefs.add(key);
      obj = ctx.lookup(obj);
      if (obj === undefined) continue;
    }
    visit(obj);
    if (obj instanceof PDFStream) stack.push(obj.dict);
    else if (obj instanceof PDFDict) for (const [, v] of obj.entries()) stack.push(v);
    else if (obj instanceof PDFArray) for (const v of obj.asArray()) stack.push(v);
  }
  return seenRefs;
}

// Nodos del árbol de páginas (intermedios y hojas), sin repetir.
function pageTreeNodes(lib, ctx, catalog) {
  const { PDFName, PDFDict, PDFArray } = lib;
  const nodes = [];
  const seen = new Set();
  const stack = [catalog.get(PDFName.of('Pages'))];
  while (stack.length) {
    const ref = stack.pop();
    const node = ctx.lookup(ref);
    if (!(node instanceof PDFDict) || seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) stack.push(...kids.asArray());
  }
  return nodes;
}

const extraKeys = (dict, allowed) => dict.keys().map((k) => k.decodeText()).filter((k) => !allowed.includes(k));

export async function scrubPdf(bytes) {
  const lib = await loadLib();
  const { PDFName, PDFDict, PDFStream } = lib;
  const doc = await loadDoc(lib, bytes);
  const ctx = doc.context;

  ctx.trailerInfo.Info = undefined;
  ctx.trailerInfo.ID = undefined;
  for (const k of extraKeys(doc.catalog, ALLOWED_CATALOG_KEYS)) doc.catalog.delete(PDFName.of(k));
  for (const node of pageTreeNodes(lib, ctx, doc.catalog)) {
    for (const k of extraKeys(node, ALLOWED_PAGE_KEYS)) node.delete(PDFName.of(k));
  }

  const reachable = walkReachable(lib, ctx, ctx.trailerInfo.Root, (obj) => {
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict) for (const k of FORBIDDEN_ANYWHERE) dict.delete(PDFName.of(k));
  });
  // Lo que ya no se alcanza (versiones viejas, anotaciones, adjuntos) no se escribe.
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) ctx.delete(ref);
  }

  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

// Cada cadena (bytes crudos) y cada flujo decodificado alcanzable, más las claves prohibidas presentes.
export async function listTextualObjects(bytes) {
  const lib = await loadLib();
  const { PDFName, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFStream, decodePDFRawStream } = lib;
  const doc = await loadDoc(lib, bytes);
  const ctx = doc.context;
  const strings = [];
  const streams = [];
  const undecoded = [];
  const encodedBodies = [];

  const roots = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  for (const root of roots) {
    walkReachable(lib, ctx, root, (obj) => {
      if (obj instanceof PDFString || obj instanceof PDFHexString) strings.push(obj.asBytes());
      else if (obj instanceof PDFRawStream) {
        const filter = obj.dict.lookup(PDFName.of('Filter'));
        const names = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
        // Un error al decodificar un filtro conocido (flujo dañado) se propaga: el control falla cerrado.
        if (names.every((n) => n instanceof PDFName && DECODABLE.has(n.decodeText()))) {
          streams.push(decodePDFRawStream(obj).decode());
          if (names.length) encodedBodies.push(obj.contents);
        } else {
          undecoded.push({ filter: names.map(String).join(' ') });
        }
      } else if (obj instanceof PDFStream) {
        streams.push(obj.getContents());
      }
    });
  }

  const forbidden = [];
  if (ctx.trailerInfo.Info) forbidden.push('trailer/Info');
  for (const k of extraKeys(doc.catalog, ALLOWED_CATALOG_KEYS)) forbidden.push(`catalog/${k}`);
  pageTreeNodes(lib, ctx, doc.catalog).forEach((node, i) => {
    for (const k of extraKeys(node, ALLOWED_PAGE_KEYS)) forbidden.push(`pagenode${i + 1}/${k}`);
  });

  return { strings, streams, undecoded, forbidden, encodedBodies };
}
