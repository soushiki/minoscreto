import { TYPE_BY_ID } from './types.js';
import { detect, COMPANY_SUFFIX_AT_END } from './detect.js';
import { normKey } from './text.js';

let sequence = 0;
const newId = () => `e${++sequence}`;

export function nextLabel(entities, type) {
  const prefix = TYPE_BY_ID[type].prefix;
  const pattern = new RegExp(`^${prefix}_(\\d+)$`);
  const used = new Set(entities.map((e) => e.label));
  let n = 1 + entities.reduce((max, e) => {
    const m = pattern.exec(e.label);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  while (used.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

export function createEntity(entities, type, value, manual = false) {
  return {
    id: newId(),
    type,
    value,
    aliases: [],
    label: nextLabel(entities, type),
    enabled: TYPE_BY_ID[type].on || manual,
    manual
  };
}

export function buildEntities(paragraphs) {
  const byKey = new Map();
  const list = [];
  for (const p of paragraphs) {
    if (!p.text.trim()) continue;
    for (const d of detect(p.text)) {
      const value = p.text.slice(d.start, d.end).trim();
      const key = normKey(value);
      if (!key || byKey.has(key)) continue;
      const entity = createEntity(list, d.type, value);
      byKey.set(key, entity);
      list.push(entity);
    }
  }
  for (const e of list) {
    if (e.type !== 'EMPRESA' || !COMPANY_SUFFIX_AT_END.test(e.value)) continue;
    const short = e.value.replace(COMPANY_SUFFIX_AT_END, '').trim();
    if (short.length >= 6 && !byKey.has(normKey(short))) {
      e.aliases.push(short);
      byKey.set(normKey(short), e);
    }
  }
  const people = list.filter((e) => e.type === 'PERSONA');
  const merged = new Set();
  for (const e of people) {
    const tokens = normKey(e.value).split(' ');
    if (tokens.length !== 1) continue;
    const host = people.find((o) => o !== e && !merged.has(o) && normKey(o.value).split(' ').length >= 2 && normKey(o.value).split(' ').includes(tokens[0]));
    if (host) { host.aliases.push(e.value); merged.add(e); }
  }
  return list.filter((e) => !merged.has(e));
}

export const toNeedles = (entities) =>
  entities.flatMap((e) => [e.value, ...e.aliases].map((value) => ({ id: e.id, value, enabled: e.enabled })));

export function findExisting(entities, text) {
  const key = normKey(text);
  return entities.find((e) => normKey(e.value) === key || e.aliases.some((a) => normKey(a) === key)) || null;
}

export function guessType(text) {
  const t = text.trim();
  const whole = detect(t).find((d) => d.start === 0 && d.end >= t.length - 1);
  return whole ? whole.type : 'OTRO';
}

export function sanitizeLabel(raw) {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9_ ]/g, '').trim().replace(/\s+/g, '_').replace(/_+/g, '_');
}

const mapEntity = (entities, id, fn) => entities.map((e) => (e.id === id ? fn(e) : e));

export const setEnabled = (entities, id, enabled) => mapEntity(entities, id, (e) => ({ ...e, enabled }));

export const setCategoryEnabled = (entities, type, enabled) =>
  entities.map((e) => (e.type === type ? { ...e, enabled } : e));

export function retype(entities, id, type) {
  const target = entities.find((e) => e.id === id);
  const automatic = /^[A-Z]+_\d+$/.test(target.label);
  const label = automatic ? nextLabel(entities.filter((e) => e.id !== id), type) : target.label;
  return mapEntity(entities, id, (e) => ({ ...e, type, label }));
}

export function renameLabel(entities, id, raw) {
  const label = sanitizeLabel(raw);
  const target = entities.find((e) => e.id === id);
  if (!label || label === target.label) return { entities };
  if (entities.some((e) => e.id !== id && e.label === label)) return { error: `Ya existe una etiqueta llamada ${label}.` };
  return { entities: mapEntity(entities, id, (e) => ({ ...e, label })) };
}

export const addAlias = (entities, id, text) =>
  mapEntity(entities, id, (e) => ({ ...e, aliases: [...e.aliases, text], enabled: true }));

export const removeAlias = (entities, id, index) =>
  mapEntity(entities, id, (e) => ({ ...e, aliases: e.aliases.filter((_, i) => i !== index) }));

export function addValue(entities, { text, type, joinId }) {
  const existing = findExisting(entities, text);
  if (existing) return setEnabled(entities, existing.id, true);
  if (joinId && entities.some((e) => e.id === joinId)) return addAlias(entities, joinId, text);
  return [...entities, createEntity(entities, type || 'OTRO', text, true)];
}
