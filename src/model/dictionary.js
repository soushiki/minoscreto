export function buildDictionary(entities, usedIds) {
  const dict = {};
  for (const e of entities) {
    if (e.enabled && (!usedIds || usedIds.has(e.id))) dict[`[${e.label}]`] = e.value;
  }
  return dict;
}

export const dictionaryToText = (dict) =>
  Object.keys(dict).map((k) => `${k}: ${dict[k]}`).join('\n') + '\n';

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
  return result;
}
