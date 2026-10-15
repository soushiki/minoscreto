const foldCache = new Map();

export function fold(s) {
  const cached = foldCache.get(s);
  if (cached !== undefined) return cached;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const base = s[i].normalize('NFD')[0] || s[i];
    const lower = base.toLowerCase();
    out += lower.length === 1 ? lower : base;
  }
  if (foldCache.size > 20000) foldCache.clear();
  foldCache.set(s, out);
  return out;
}

export const normKey = (value) => fold(value).replace(/\s+/g, ' ').trim();

const WORD_CHAR = /[\p{L}\p{N}_]/u;
export const isWordChar = (ch) => ch !== undefined && ch !== '' && WORD_CHAR.test(ch);

export function findOccurrences(text, needles) {
  if (!text) return [];
  const folded = fold(text);
  const candidates = [];
  for (const needle of needles) {
    const target = fold(needle.value);
    if (!target) continue;
    const startsWord = isWordChar(target[0]);
    const endsWord = isWordChar(target[target.length - 1]);
    let from = 0;
    let idx;
    while ((idx = folded.indexOf(target, from)) !== -1) {
      const end = idx + target.length;
      if ((!startsWord || !isWordChar(folded[idx - 1])) && (!endsWord || !isWordChar(folded[end]))) {
        candidates.push({ start: idx, end, id: needle.id, enabled: needle.enabled !== false, len: target.length });
      }
      from = idx + 1;
    }
  }
  if (!candidates.length) return [];
  candidates.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return b.len - a.len || a.start - b.start;
  });
  const taken = new Uint8Array(text.length);
  const result = [];
  for (const c of candidates) {
    let free = true;
    for (let k = c.start; k < c.end; k++) {
      if (taken[k]) { free = false; break; }
    }
    if (!free) continue;
    taken.fill(1, c.start, c.end);
    result.push({ start: c.start, end: c.end, id: c.id });
  }
  return result.sort((a, b) => a.start - b.start);
}

export function searchRanges(text, query) {
  const target = fold(query);
  if (!target) return [];
  const folded = fold(text);
  const ranges = [];
  let from = 0;
  let idx;
  while ((idx = folded.indexOf(target, from)) !== -1) {
    ranges.push([idx, idx + target.length]);
    from = idx + target.length;
  }
  return ranges;
}

export function replaceInString(text, ranges) {
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    out += text.slice(pos, r.start) + r.text;
    pos = r.end;
  }
  return out + text.slice(pos);
}

export function segmentsOf(text, occurrences, hits) {
  const points = new Set([0, text.length]);
  occurrences.forEach((o) => { points.add(o.start); points.add(o.end); });
  hits.forEach((h) => { points.add(h[0]); points.add(h[1]); });
  const sorted = [...points].sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    segments.push({
      text: text.slice(start, end),
      start,
      occurrence: occurrences.find((o) => o.start <= start && start < o.end) || null,
      hit: hits.find((h) => h[0] <= start && start < h[1]) || null
    });
  }
  return segments;
}
