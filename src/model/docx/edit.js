import { W_NS, XML_NS, XML_HEAD, DOCX_MIME } from './constants.js';
import { findOccurrences, replaceInString } from '../text.js';

function setText(node, text) {
  node.textContent = text;
  node.setAttributeNS(XML_NS, 'xml:space', 'preserve');
}

export function applyRanges(paragraph, ranges) {
  for (let r = ranges.length - 1; r >= 0; r--) {
    const { start, end, text } = ranges[r];
    let first = true;
    for (const n of paragraph.nodes) {
      if (n.end <= start || n.start >= end) continue;
      const current = n.node.textContent;
      const from = Math.max(start, n.start) - n.start;
      const to = Math.min(end, n.end) - n.start;
      setText(n.node, current.slice(0, from) + (first ? text : '') + current.slice(to));
      first = false;
    }
  }
}

export function scrubFlatNodes(dom, needles, textFor) {
  for (const name of ['delText', 'instrText']) {
    for (const node of Array.from(dom.getElementsByTagNameNS(W_NS, name))) {
      const value = node.textContent;
      const found = findOccurrences(value, needles);
      if (!found.length) continue;
      setText(node, replaceInString(value, found.map((o) => ({ start: o.start, end: o.end, text: textFor(o.id, name) }))));
    }
  }
}

export async function scrubMetadata(zip) {
  const blank = (xml, tags) => tags.reduce(
    (s, tag) => s.replace(new RegExp(`(<${tag}[^>]*>)[^<]*(</${tag}>)`), '$1$2'), xml);
  const core = zip.file('docProps/core.xml');
  if (core) {
    const xml = await core.async('string');
    zip.file('docProps/core.xml', blank(xml, ['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'cp:keywords', 'dc:description', 'cp:category']));
  }
  const app = zip.file('docProps/app.xml');
  if (app) zip.file('docProps/app.xml', blank(await app.async('string'), ['Company', 'Manager']));
  Object.keys(zip.files).filter((p) => /^docProps\/thumbnail\./i.test(p)).forEach((p) => zip.remove(p));
  const rels = zip.file('_rels/.rels');
  if (rels) zip.file('_rels/.rels', (await rels.async('string')).replace(/<Relationship\b[^>]*thumbnail[^>]*\/>/gi, ''));
}

export function writeParts(doc) {
  const serializer = new XMLSerializer();
  for (const part of doc.parts) {
    const xml = serializer.serializeToString(part.dom).replace(/^<\?xml[^>]*\?>\s*/, '');
    doc.zip.file(part.path, XML_HEAD + xml);
  }
}

export const generateDocx = (zip) =>
  zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
