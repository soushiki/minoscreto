import { openDocx } from './package.js';
import { applyRanges, writeParts, generateDocx } from './edit.js';
import { findOccurrences } from '../text.js';

const PLACEHOLDER = /\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9_ ]{1,40}\]/g;

function dictionaryNeedles(dict) {
  return Object.keys(dict).flatMap((key) => {
    const needles = [{ id: key, value: key, enabled: true }];
    const bare = key.replace(/^\[|\]$/g, '');
    if (bare !== key && bare.length >= 3) needles.push({ id: key, value: bare, enabled: true });
    return needles;
  });
}

function unknownPlaceholders(text, found, dict) {
  const unknown = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const covered = found.some((o) => o.start <= m.index && m.index < o.end);
    if (!covered && dict[m[0]] === undefined) unknown.push(m[0]);
  }
  return unknown;
}

const swallowDuplicatedDot = (value, text, end) => (value.endsWith('.') && text[end] === '.' ? end + 1 : end);

export function restoreText(text, dict) {
  const needles = dictionaryNeedles(dict);
  const counts = {};
  const unknown = new Set();
  const segments = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const found = findOccurrences(line, needles);
    let pos = 0;
    for (const o of found) {
      if (o.start > pos) segments.push({ text: line.slice(pos, o.start) });
      segments.push({ text: dict[o.id], restored: true, key: o.id });
      counts[o.id] = (counts[o.id] || 0) + 1;
      pos = swallowDuplicatedDot(dict[o.id], line, o.end);
    }
    if (pos < line.length) segments.push({ text: line.slice(pos) });
    unknownPlaceholders(line, found, dict).forEach((u) => unknown.add(u));
    if (i < lines.length - 1) segments.push({ text: '\n' });
  });
  return { text: segments.map((s) => s.text).join(''), segments, counts, unknown: [...unknown] };
}

export async function restoreDocx(buffer, dict) {
  const doc = await openDocx(buffer);
  const needles = dictionaryNeedles(dict);
  const counts = {};
  const unknown = new Set();
  for (const paragraph of doc.paragraphs) {
    if (!paragraph.text.trim()) continue;
    const found = findOccurrences(paragraph.text, needles);
    const ranges = found.map((o) => {
      counts[o.id] = (counts[o.id] || 0) + 1;
      return { start: o.start, end: swallowDuplicatedDot(dict[o.id], paragraph.text, o.end), text: dict[o.id] };
    });
    unknownPlaceholders(paragraph.text, found, dict).forEach((u) => unknown.add(u));
    applyRanges(paragraph, ranges);
  }
  writeParts(doc);
  return { blob: await generateDocx(doc.zip), counts, unknown: [...unknown] };
}
