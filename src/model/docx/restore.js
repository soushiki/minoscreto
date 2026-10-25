import { openDocx } from './package.js';
import { applyRanges, writeParts, generateDocx } from './edit.js';
import { findOccurrences } from '../text.js';
import { dictionaryVariants } from '../dictionary.js';

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

// La enésima aparición de una etiqueta vuelve a su enésima variante; si el número no cuadra, todas vuelven al valor principal.
function restorer(dict, counts) {
  const variants = dictionaryVariants(dict);
  const seen = {};
  return (key) => {
    seen[key] = (seen[key] || 0) + 1;
    const list = variants[key];
    return list && list.length === counts[key] ? list[seen[key] - 1] : dict[key];
  };
}

function tally(foundLists) {
  const counts = {};
  for (const found of foundLists) for (const o of found) counts[o.id] = (counts[o.id] || 0) + 1;
  return counts;
}

export function restoreText(text, dict) {
  const needles = dictionaryNeedles(dict);
  const unknown = new Set();
  const segments = [];
  const lines = text.split('\n');
  const foundLists = lines.map((line) => findOccurrences(line, needles));
  const counts = tally(foundLists);
  const next = restorer(dict, counts);
  lines.forEach((line, i) => {
    const found = foundLists[i];
    let pos = 0;
    for (const o of found) {
      if (o.start > pos) segments.push({ text: line.slice(pos, o.start) });
      const value = next(o.id);
      segments.push({ text: value, restored: true, key: o.id });
      pos = swallowDuplicatedDot(value, line, o.end);
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
  const unknown = new Set();
  const paragraphs = doc.paragraphs.filter((p) => p.text.trim());
  const foundLists = paragraphs.map((p) => findOccurrences(p.text, needles));
  const counts = tally(foundLists);
  const next = restorer(dict, counts);
  paragraphs.forEach((paragraph, i) => {
    const found = foundLists[i];
    const ranges = found.map((o) => {
      const value = next(o.id);
      return { start: o.start, end: swallowDuplicatedDot(value, paragraph.text, o.end), text: value };
    });
    unknownPlaceholders(paragraph.text, found, dict).forEach((u) => unknown.add(u));
    applyRanges(paragraph, ranges);
  });
  writeParts(doc);
  return { blob: await generateDocx(doc.zip), counts, unknown: [...unknown] };
}
