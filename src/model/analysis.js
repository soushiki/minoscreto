import { findOccurrences, searchRanges, normKey } from './text.js';
import { toNeedles } from './entities.js';

export const occurrenceKey = (paragraphIndex, start) => `${paragraphIndex}:${start}`;

export function analyze(paragraphs, entities, excluded) {
  const needles = toNeedles(entities);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const counts = {};
  const usedIds = new Set();
  let replacements = 0;
  const occurrences = paragraphs.map((p, pi) => {
    if (!p.text.trim()) return [];
    return findOccurrences(p.text, needles, { join: true }).map((o) => {
      const key = occurrenceKey(pi, o.start);
      const entity = byId.get(o.id);
      const replaced = entity.enabled && !excluded.has(key);
      counts[o.id] = (counts[o.id] || 0) + 1;
      if (replaced) { replacements++; usedIds.add(o.id); }
      return { ...o, key, replaced };
    });
  });
  return { occurrences, counts, usedIds, replacements };
}

const SMALL_WORDS = new Set(['de', 'del', 'la', 'los', 'las', 'y']);

export function findSuggestions(paragraphs, entities, analysis) {
  const known = new Set();
  entities.forEach((e) => {
    known.add(normKey(e.value));
    e.aliases.forEach((a) => known.add(normKey(a)));
  });
  const candidates = new Map();
  for (const e of entities) {
    if (!e.enabled || e.type !== 'PERSONA') continue;
    for (const token of e.value.split(/\s+/)) {
      const key = normKey(token);
      if (key.length < 4 || SMALL_WORDS.has(key) || known.has(key) || candidates.has(key)) continue;
      candidates.set(key, { token, entityId: e.id });
    }
  }
  const result = [];
  for (const { token, entityId } of candidates.values()) {
    const needle = [{ id: 'x', value: token, enabled: true }];
    let count = 0;
    paragraphs.forEach((p, pi) => {
      if (!p.text) return;
      for (const hit of findOccurrences(p.text, needle)) {
        const covered = analysis.occurrences[pi].some((o) => o.replaced && o.start < hit.end && hit.start < o.end);
        if (!covered) count++;
      }
    });
    if (count > 0) result.push({ token, entityId, count });
  }
  return result;
}

export function findHits(paragraphs, query) {
  const q = query.trim();
  const byParagraph = new Map();
  const list = [];
  if (q.length < 2) return { list, byParagraph };
  paragraphs.forEach((p, pi) => {
    if (!p.text.trim()) return;
    const ranges = searchRanges(p.text, q);
    if (!ranges.length) return;
    byParagraph.set(pi, ranges);
    ranges.forEach(([start, end]) => list.push({ pi, start, end }));
  });
  return { list, byParagraph };
}

export function countMatches(paragraphs, text) {
  const needle = [{ id: 'x', value: text, enabled: true }];
  return paragraphs.reduce((sum, p) => sum + findOccurrences(p.text, needle).length, 0);
}
