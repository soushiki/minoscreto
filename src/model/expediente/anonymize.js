import { findOccurrences, replaceInString, fold, normKey } from '../text.js';
import { toNeedles } from '../entities.js';

/** Reemplaza en cada párrafo los datos activos por su etiqueta; un solo diccionario para todo el expediente. */
export function anonymizeTexts(texts, entities) {
  const needles = toNeedles(entities);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const counts = {};
  const usedIds = [];
  const used = new Set();
  let replacements = 0;
  const out = texts.map((text) => {
    if (!text.trim()) return text;
    const ranges = [];
    for (const o of findOccurrences(text, needles)) {
      counts[o.id] = (counts[o.id] || 0) + 1;
      const entity = byId.get(o.id);
      if (!entity.enabled) continue;
      ranges.push({ start: o.start, end: o.end, text: `[${entity.label}]` });
      if (!used.has(o.id)) { used.add(o.id); usedIds.push(o.id); }
    }
    replacements += ranges.length;
    return ranges.length ? replaceInString(text, ranges) : text;
  });
  return { texts: out, counts, usedIds, replacements };
}

/** Índice de búsqueda: el texto plegado (sin tildes ni mayúsculas) conserva las posiciones del original. */
export const buildSearchIndex = (texts) => texts.map((t) => fold(t));

export function searchIndex(index, query, limit = 300) {
  const target = fold(query.trim());
  const hits = [];
  const paragraphs = new Set();
  let total = 0;
  if (target.length < 2) return { hits, total, paragraphs };
  index.forEach((folded, pi) => {
    let from = 0;
    let at;
    while ((at = folded.indexOf(target, from)) !== -1) {
      total++;
      paragraphs.add(pi);
      if (hits.length < limit) hits.push({ pi, start: at, end: at + target.length });
      from = at + target.length;
    }
  });
  return { hits, total, paragraphs };
}

function editDistanceAtMost1(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) ? 1 : 2;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i) ? 1 : 2;
}

// Errores típicos del OCR que cuestan 2 en distancia de edición pero son uno visual.
const OCR_PAIRS = [['rn', 'm'], ['m', 'rn'], ['cl', 'd'], ['li', 'h'], ['vv', 'w']];
function wordDistance(a, b) {
  const d = editDistanceAtMost1(a, b);
  if (d <= 1) return d;
  for (const [x, y] of OCR_PAIRS) {
    let at = a.indexOf(x);
    while (at !== -1) {
      if (a.slice(0, at) + y + a.slice(at + x.length) === b) return 1;
      at = a.indexOf(x, at + 1);
    }
  }
  return 2;
}

const OCR_DIGITS = { 0: 'o', 1: 'l', 5: 's', 8: 'b' };
const cleanWord = (w) => fold(w).replace(/[0158]/g, (d) => OCR_DIGITS[d]);
const looksCapital = (w) => /^[\p{Lu}01]/u.test(w);

/**
 * Sugiere variantes de nombres ya detectados que el OCR escribió mal («Martlnez», «Marlha»):
 * secuencias de palabras con mayúscula del mismo largo, con a lo sumo un error por palabra y dos en total.
 * Si la variante ya es otra entidad (el detector la tomó como persona distinta), propone unirlas en una sola etiqueta.
 * Devuelve [{ entityId, variant, count, mergeFrom? }].
 */
export function findOcrVariants(texts, entities, { maxPerEntity = 8 } = {}) {
  const targets = entities
    .filter((e) => e.type === 'PERSONA' || e.type === 'EMPRESA')
    .map((e) => ({ e, words: normKey(e.value).split(' ').filter(Boolean).map(cleanWord) }))
    .filter((t) => t.words.length >= 2 && t.words.length <= 6);
  if (!targets.length) return [];
  const owner = new Map();
  for (const e of entities) for (const v of [e.value, ...e.aliases]) owner.set(normKey(v), e);
  const byLength = new Map();
  for (const t of targets) {
    if (!byLength.has(t.words.length)) byLength.set(t.words.length, []);
    byLength.get(t.words.length).push(t);
  }
  const windows = new Map();
  const wordRe = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
  for (const text of texts) {
    const words = [];
    let m;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(text))) {
      const w = m[0].replace(/[.,-]+$/, '');
      words.push({ w, s: m.index, e: m.index + w.length });
    }
    for (let i = 0; i < words.length; i++) {
      if (!looksCapital(words[i].w)) continue;
      for (const k of byLength.keys()) {
        if (i + k > words.length) continue;
        let ok = true;
        for (let j = i; j < i + k; j++) {
          if (!looksCapital(words[j].w) || (j > i && !/^\s+$/.test(text.slice(words[j - 1].e, words[j].s)))) { ok = false; break; }
        }
        if (!ok) continue;
        const raw = text.slice(words[i].s, words[i + k - 1].e);
        const key = normKey(raw);
        const entry = windows.get(key);
        if (entry) entry.count++;
        else windows.set(key, { raw, key, k, count: 1, words: words.slice(i, i + k).map((x) => cleanWord(x.w)) });
      }
    }
  }
  const countOf = (e) => windows.get(normKey(e.value))?.count || 0;
  const suggestions = [];
  const merged = new Set();
  for (const win of windows.values()) {
    const current = owner.get(win.key);
    for (const t of byLength.get(win.k)) {
      // Un «nombre propio» mal escrito por el OCR puede ser una persona o empresa ya detectada («Dlana Marcela Torres Gómez»).
      if (current && (current === t.e || (current.type !== t.e.type && current.type !== 'NOMBRE'))) continue;
      let total = 0;
      let exact = 0;
      let ok = true;
      for (let j = 0; j < win.k && ok; j++) {
        const a = win.words[j];
        const b = t.words[j];
        const d = a === b ? 0 : (b.length < 4 ? 2 : wordDistance(a, b));
        if (d > 1) ok = false;
        total += d;
        if (d === 0) exact++;
      }
      if (!ok || total < 1 || total > 2 || exact < Math.max(1, win.k - 2)) continue;
      if (current) {
        // Dos entidades casi iguales: la que más aparece se queda con la etiqueta.
        const pair = [current.id, t.e.id].sort().join('|');
        if (merged.has(pair) || countOf(current) > countOf(t.e) || (current.manual && !t.e.manual)) continue;
        merged.add(pair);
        suggestions.push({ entityId: t.e.id, variant: current.value, count: countOf(current), mergeFrom: current.id });
      } else {
        suggestions.push({ entityId: t.e.id, variant: win.raw, count: win.count });
      }
      break;
    }
  }
  const byEntity = new Map();
  for (const s of suggestions) {
    if (!byEntity.has(s.entityId)) byEntity.set(s.entityId, []);
    byEntity.get(s.entityId).push(s);
  }
  return [...byEntity.values()].flatMap((list) => list.sort((a, b) => b.count - a.count).slice(0, maxPerEntity));
}

/** Une una entidad en otra: su valor y variantes pasan a ser variantes de la que queda. */
export function mergeEntities(entities, fromId, intoId) {
  const from = entities.find((e) => e.id === fromId);
  if (!from || fromId === intoId) return entities;
  return entities
    .filter((e) => e.id !== fromId)
    .map((e) => (e.id === intoId ? { ...e, enabled: e.enabled || from.enabled, aliases: [...e.aliases, from.value, ...from.aliases] } : e));
}

/** Aplica una sugerencia de OCR: une entidades o agrega la variante como alias. */
export function acceptOcrVariant(entities, suggestion) {
  if (suggestion.mergeFrom) return mergeEntities(entities, suggestion.mergeFrom, suggestion.entityId);
  return entities.map((e) => (e.id === suggestion.entityId ? { ...e, enabled: true, aliases: [...e.aliases, suggestion.variant] } : e));
}

/** Pedazos sueltos que deja el OCR («J», «Car»): reemplazarlos en todo el texto haría más daño que bien. */
export const tidyEntities = (entities) =>
  entities.map((e) => (!e.manual && (e.type === 'PERSONA' || e.type === 'EMPRESA') && normKey(e.value).replace(/[^\p{L}]/gu, '').length < 4
    ? { ...e, enabled: false } : e));
