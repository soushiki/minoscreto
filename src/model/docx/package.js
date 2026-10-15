import JSZip from 'jszip';
import { W_NS } from './constants.js';

const PART_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const PART_LABELS = [
  [/header/, 'Encabezado'],
  [/footer/, 'Pie de página'],
  [/footnotes/, 'Nota al pie'],
  [/endnotes/, 'Nota final'],
  [/comments/, 'Comentario']
];

export class DocxError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function partLabel(path) {
  if (/document\.xml$/.test(path)) return '';
  const found = PART_LABELS.find(([pattern]) => pattern.test(path));
  return found ? found[1] : '';
}

const partOrder = (a, b) => {
  if (a === 'word/document.xml') return -1;
  if (b === 'word/document.xml') return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

const OFF = new Set(['0', 'false', 'off']);

/** Lee el texto del párrafo y dónde caen sus saltos de página (los que Word guardó al paginar y los manuales). */
function readParagraph(p) {
  let text = '';
  const nodes = [];
  const breaks = [];
  const walk = (parent) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      if (child.namespaceURI === W_NS) {
        const name = child.localName;
        if (name === 'p') continue;
        if (name === 't') {
          const value = child.textContent;
          nodes.push({ node: child, start: text.length, end: text.length + value.length });
          text += value;
          continue;
        }
        if (name === 'lastRenderedPageBreak') { breaks.push({ at: text.length, rendered: true }); continue; }
        if (name === 'pageBreakBefore' && !OFF.has(child.getAttributeNS(W_NS, 'val') || '')) { breaks.push({ at: 0, rendered: false }); continue; }
        if (name === 'br' && child.getAttributeNS(W_NS, 'type') === 'page') breaks.push({ at: text.length, rendered: false });
        if (name === 'tab' || name === 'br' || name === 'cr') { text += ' '; continue; }
      }
      walk(child);
    }
  };
  walk(p);
  return { text, nodes, breaks };
}

export async function openDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('word/document.xml')) throw new DocxError('NO_DOCX');
  const paths = Object.keys(zip.files).filter((p) => PART_PATTERN.test(p)).sort(partOrder);
  const parts = [];
  const paragraphs = [];
  for (const path of paths) {
    const xml = await zip.file(path).async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) throw new DocxError('BAD_XML');
    parts.push({ path, dom });
    for (const p of Array.from(dom.getElementsByTagNameNS(W_NS, 'p'))) {
      paragraphs.push({ ...readParagraph(p), part: path, index: paragraphs.length });
    }
  }
  const main = parts[0].dom;
  const warnings = {
    tracked: main.getElementsByTagNameNS(W_NS, 'ins').length + main.getElementsByTagNameNS(W_NS, 'del').length,
    comments: zip.file('word/comments.xml') ? 1 : 0,
    images: Object.keys(zip.files).filter((p) => /^word\/media\//.test(p)).length
  };
  return { zip, parts, paragraphs, warnings };
}
