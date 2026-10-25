export const VARIANTS_KEY = '__variants__';

// Las variantes viajan ocultas (no enumerables): quien recorre el diccionario sigue viendo solo etiquetas.
function attachVariants(dict, variants) {
  if (Object.keys(variants).length) Object.defineProperty(dict, VARIANTS_KEY, { value: variants });
  return dict;
}

/** { '[PERSONA_1]': ['Fidel castro', 'castro'] }: la enésima aparición de la etiqueta vuelve a la enésima variante. */
export const dictionaryVariants = (dict) => (dict && dict[VARIANTS_KEY]) || {};

/** Para el .json: las etiquetas y, si hay, las variantes bajo «__variants__». */
export const dictionaryWithVariants = (dict) =>
  (dict[VARIANTS_KEY] ? { ...dict, [VARIANTS_KEY]: dict[VARIANTS_KEY] } : dict);

/** Texto exacto de cada aparición reemplazada, por entidad y en el orden en que sale en el documento. */
export function collectSources(texts, occurrences) {
  const sources = {};
  occurrences.forEach((list, i) => {
    for (const o of list) {
      if (o.replaced !== false) (sources[o.id] ||= []).push(texts[i].slice(o.start, o.end));
    }
  });
  return sources;
}

export function buildDictionary(entities, usedIds, sources) {
  const dict = {};
  const variants = {};
  for (const e of entities) {
    if (!e.enabled || (usedIds && !usedIds.has(e.id))) continue;
    const key = `[${e.label}]`;
    dict[key] = e.value;
    const list = sources && sources[e.id];
    if (list && list.some((s) => s !== e.value)) variants[key] = list;
  }
  return attachVariants(dict, variants);
}

export const dictionaryToText = (dict) =>
  Object.keys(dict).map((k) => `${k}: ${dict[k]}`).join('\n') + '\n';

function readVariants(raw, dict) {
  const variants = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return variants;
  for (const [key, list] of Object.entries(raw)) {
    const k = key.trim();
    if (Object.hasOwn(dict, k) && Array.isArray(list) && list.length && list.every((s) => typeof s === 'string')) variants[k] = list;
  }
  return variants;
}

export function parseDictionary(text) {
  const clean = text.replace(/^﻿/, '').trim();
  if (!clean) throw new Error('El archivo está vacío.');
  let parsed = null;
  try {
    const json = JSON.parse(clean);
    if (json && typeof json === 'object' && !Array.isArray(json)) parsed = json;
  } catch {
    parsed = null;
  }
  const result = {};
  if (parsed) {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' || typeof value === 'number') result[key.trim()] = String(value);
    }
  } else {
    for (const line of clean.split(/\r?\n/)) {
      const m = /^\s*(\[?[\p{L}\p{N}_ ]+\]?)\s*[:=]\s*(.*?)\s*$/u.exec(line);
      if (m && m[2]) result[m[1].trim()] = m[2];
    }
  }
  if (!Object.keys(result).length) throw new Error('No se encontraron pares LLAVE: VALOR en el archivo.');
  return attachVariants(result, readVariants(parsed && parsed[VARIANTS_KEY], result));
}
