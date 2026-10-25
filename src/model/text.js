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

const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
/**
 * ¿El borde de un dato sigue dentro de una palabra más larga? Una letra pegada a otra letra («Ana» en «Anabel») o una
 * cifra pegada a otra cifra («123» en «1234») sí; una cifra pegada a letras o guiones bajos no: «CC71234567»,
 * «43.210.987de», «___43.210.987», o la llamada de nota en «Almeida3».
 */
function glued(edge, neighbor) {
  if (neighbor === undefined || neighbor === '') return false;
  if (LETTER.test(edge)) return LETTER.test(neighbor);
  if (DIGIT.test(edge)) return DIGIT.test(neighbor);
  return false;
}

/** Dos hallazgos de la misma entidad separados solo por espacios («Fidel» + «castro») son un solo tramo. */
function joinAdjacent(text, list) {
  const out = [];
  for (const o of list) {
    const last = out[out.length - 1];
    if (last && last.id === o.id && o.start > last.end && /^[  ]+$/.test(text.slice(last.end, o.start))) last.end = o.end;
    else out.push({ ...o });
  }
  return out;
}

export function findOccurrences(text, needles, { join = false } = {}) {
  if (!text) return [];
  const folded = fold(text);
  const candidates = [];
  for (const needle of needles) {
    const target = fold(needle.value);
    if (!target) continue;
    let from = 0;
    let idx;
    while ((idx = folded.indexOf(target, from)) !== -1) {
      const end = idx + target.length;
      if (!glued(target[0], folded[idx - 1]) && !glued(target[target.length - 1], folded[end])) {
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
  result.sort((a, b) => a.start - b.start);
  return join ? joinAdjacent(text, result) : result;
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
