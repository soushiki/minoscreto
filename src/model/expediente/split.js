import { estimateTokens } from './document.js';

/** Reserva para el encabezado «Parte X de N» y la instrucción a la IA. */
export const PART_HEADER_TOKENS = 160;
const MARKER_TOKENS = 4;

function blockCosts(blocks) {
  return blocks.map((b, i) => estimateTokens(b.text.length + 2) + (i === 0 || blocks[i - 1].page !== b.page ? MARKER_TOKENS : 0));
}

const sum = (costs, from, to) => { let n = 0; for (let i = from; i < to; i++) n += costs[i]; return n; };

function withOverlap(ranges, overlap) {
  return ranges.map(([from, to], k) => ({ from, to, overlapFrom: k === 0 ? from : Math.max(ranges[k - 1][0], from - overlap) }));
}

function byPages(blocks, pagesPerPart) {
  const size = Math.max(1, Math.floor(pagesPerPart));
  const ranges = [];
  let from = 0;
  let pages = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (i > from && blocks[i].page !== blocks[i - 1].page) {
      pages++;
      if (pages >= size) { ranges.push([from, i]); from = i; pages = 0; }
    }
  }
  if (from < blocks.length) ranges.push([from, blocks.length]);
  return ranges;
}

/** Llena partes con párrafos completos hasta el tope de tokens (contando el solapamiento que repite cada parte). */
function byTokens(costs, from, to, budget, overlap, startOverlap = 0) {
  const ranges = [];
  let start = from;
  let used = startOverlap;
  for (let i = from; i < to; i++) {
    if (i > start && used + costs[i] > budget) {
      ranges.push([start, i]);
      start = i;
      used = sum(costs, Math.max(ranges[ranges.length - 1][0], i - overlap), i);
    }
    used += costs[i];
  }
  if (start < to) ranges.push([start, to]);
  return ranges;
}

/** Corta solo donde empieza un título; si una sección sola no cabe, la parte por párrafos. */
function bySections(blocks, costs, budget, overlap) {
  const starts = [0];
  blocks.forEach((b, i) => { if (i > 0 && b.heading) starts.push(i); });
  const sections = starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : blocks.length]);
  const ranges = [];
  let current = null;
  const overlapCost = (at) => (ranges.length || current ? sum(costs, Math.max(0, at - overlap), at) : 0);
  for (const [s, e] of sections) {
    const cost = sum(costs, s, e);
    if (current && current.used + cost <= budget) { current.to = e; current.used += cost; continue; }
    if (current) ranges.push([current.from, current.to]);
    const lead = overlapCost(s);
    if (lead + cost <= budget) { current = { from: s, to: e, used: lead + cost }; continue; }
    const pieces = byTokens(costs, s, e, budget, overlap, lead);
    const last = pieces.pop();
    ranges.push(...pieces);
    current = { from: last[0], to: last[1], used: sum(costs, Math.max(0, last[0] - overlap), last[1]) };
  }
  if (current) ranges.push([current.from, current.to]);
  return ranges;
}

/**
 * Divide los bloques (párrafos con folio) en partes sin cortar ningún párrafo.
 * mode: 'pages' (folios por parte), 'tokens' (tope estimado) o 'sections' (títulos, sin pasar del tope).
 * overlap: cuántos párrafos del final de una parte se repiten al inicio de la siguiente.
 */
export function splitParts(blocks, { mode = 'tokens', pagesPerPart = 100, maxTokens = 50000, overlap = 0 } = {}) {
  if (!blocks.length) return [];
  const ov = Math.max(0, Math.floor(overlap));
  const costs = blockCosts(blocks);
  const budget = Math.max(500, maxTokens - PART_HEADER_TOKENS);
  let ranges;
  if (mode === 'pages') ranges = byPages(blocks, pagesPerPart);
  else if (mode === 'sections') ranges = bySections(blocks, costs, budget, ov);
  else ranges = byTokens(costs, 0, blocks.length, budget, ov);
  return withOverlap(ranges, ov).map((r) => ({ ...r, tokens: sum(costs, r.overlapFrom, r.to) + PART_HEADER_TOKENS }));
}
