import { openDocx } from './package.js';
import { applyRanges, scrubFlatNodes, scrubMetadata, writeParts, generateDocx } from './edit.js';
import { findOccurrences, replaceInString } from '../text.js';
import { toNeedles } from '../entities.js';
import { occurrenceKey } from '../analysis.js';

export async function exportAnonymized(buffer, entities, excluded) {
  const doc = await openDocx(buffer);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const needles = toNeedles(entities);
  let count = 0;

  for (const paragraph of doc.paragraphs) {
    if (!paragraph.text.trim()) continue;
    const ranges = [];
    for (const o of findOccurrences(paragraph.text, needles)) {
      const entity = byId.get(o.id);
      if (!entity.enabled || excluded.has(occurrenceKey(paragraph.index, o.start))) continue;
      ranges.push({ start: o.start, end: o.end, text: `[${entity.label}]` });
    }
    applyRanges(paragraph, ranges);
    count += ranges.length;
  }

  const active = needles.filter((n) => n.enabled);
  for (const part of doc.parts) {
    scrubFlatNodes(part.dom, active, (id, nodeName) => {
      const label = byId.get(id).label;
      return nodeName === 'instrText' ? label : `[${label}]`;
    });
  }
  writeParts(doc);

  const relPaths = Object.keys(doc.zip.files).filter((p) => /^word\/_rels\/.+\.rels$/.test(p));
  for (const path of relPaths) {
    const xml = await doc.zip.file(path).async('string');
    const found = findOccurrences(xml, active);
    if (found.length) {
      doc.zip.file(path, replaceInString(xml, found.map((o) => ({ start: o.start, end: o.end, text: byId.get(o.id).label }))));
    }
  }
  await scrubMetadata(doc.zip);
  return { blob: await generateDocx(doc.zip), count };
}
