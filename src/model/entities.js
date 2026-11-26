import { TYPE_BY_ID } from './types.js';
import { SCORES } from './scores.js';
import { signatureNames } from './signatures.js';
import { detect, COMPANY_SUFFIX_AT_END } from './detect.js';
import { normKey, findOccurrences } from './text.js';
import { COMMON_NOUNS, COMMON_LOWER_NAMES, AMBIGUOUS_FIRST_NAMES, CONNECTORS } from './lexicon.js';
import { buildNameContext, withoutCue } from './properNouns.js';

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

const keyWords = (key) => ` ${key} `;

/**
 * Un «nombre propio» que ya es otra entidad (su valor o variante) o parte de un nombre de persona o empresa
 * no se duplica. Las partes sueltas de un nombre («Mendoza», «Carlos») se dejan a las sugerencias de fugas:
 * unirlas solas podría mezclar a dos personas con el mismo nombre.
 */
function dropNamesCoveredByOthers(list) {
  const others = list.filter((e) => e.type !== 'NOMBRE' && e.type !== 'LUGAR');
  return list.filter((e) => {
    if (e.type !== 'NOMBRE') return true;
    const key = normKey(e.value);
    return !others.some((o) => [o.value, ...o.aliases].some((v) => normKey(v) === key)
      || ((o.type === 'PERSONA' || o.type === 'EMPRESA') && keyWords(normKey(o.value)).includes(keyWords(key))));
  });
}

/** «Proyecto Altamira» y «Altamira» son el mismo nombre: una sola etiqueta, con la otra forma como variante. */
function mergeCueVariants(list, byKey) {
  const dropped = new Set();
  for (const e of list) {
    if (e.type !== 'NOMBRE' || dropped.has(e)) continue;
    const short = withoutCue(e.value);
    if (!short) continue;
    const other = byKey.get(normKey(short));
    if (other && other !== e && other.type === 'NOMBRE') {
      e.aliases.push(other.value, ...other.aliases);
      e.enabled = e.enabled || other.enabled;
      if (!other.weak) delete e.weak;
      dropped.add(other);
    } else if (!other) {
      e.aliases.push(short);
    }
    byKey.set(normKey(short), e);
  }
  return list.filter((e) => !dropped.has(e));
}

// Un párrafo que no cierra con puntuación y otro que sigue con mayúscula o número pueden ser una sola línea partida
// (OCR, tablas, Word convertido de PDF): «RUBIELA ESPERANZA CORTÉS ¶ MALAGÓN», «cédula de ciudadanía No. ¶ 52.318.904».
// Abierto: sin puntuación de cierre, o con una abreviatura corta al final («No.», «Nro.», «C.C.», «Sr.»).
const OPEN_END = /(?:[^.;:!?»”")\]]|(?:^|[\s(])(?:\p{L}{1,3}\.){1,2}|N[°º]\.?)\s*$/u;
const CONTINUES = /^\s*[\p{Lu}\d]/u;
const ACROSS_TYPES = new Set(['PERSONA', 'CEDULA', 'NIT', 'CUENTA', 'TELEFONO', 'CORREO', 'DIRECCION']);
const MAX_CHAIN = 6;
const MAX_PIECE_LINE = 120;

/**
 * Detecta en cadenas de párrafos que siguen uno al otro y devuelve lo que la detección por párrafo no puede ver:
 * datos partidos entre párrafos (con sus pedazos, uno por párrafo, para reemplazarlos donde están) y números cuya pista
 * quedó en el párrafo anterior. Solo mira párrafos cortos, como las líneas sueltas de un OCR.
 */
function detectAcrossBreaks(paragraphs, context) {
  const out = [];
  const texts = paragraphs.map((p) => p.text.trim());
  let i = 0;
  while (i < texts.length) {
    let j = i;
    while (j + 1 < texts.length && j - i + 1 < MAX_CHAIN && texts[j] && texts[j + 1]
      && (texts[j].length <= MAX_PIECE_LINE || texts[j + 1].length <= MAX_PIECE_LINE)
      && !paragraphs[j].pair && !paragraphs[j + 1].pair && OPEN_END.test(texts[j]) && CONTINUES.test(texts[j + 1])) j++;
    if (j > i) {
      let joined = '';
      const spans = [];
      for (let k = i; k <= j; k++) {
        if (joined) joined += ' ';
        spans.push({ s: joined.length, e: joined.length + texts[k].length });
        joined += texts[k];
      }
      for (const d of detect(joined, context)) {
        if (!ACROSS_TYPES.has(d.type) || d.weak) continue;
        const touched = spans.filter((sp) => sp.s < d.end && d.start < sp.e);
        const crosses = touched.length > 1;
        // Un número entero dentro de un párrafo ya lo vio la detección por párrafo, salvo que su pista esté en el anterior.
        if (!crosses && d.type === 'PERSONA') continue;
        const value = joined.slice(d.start, d.end).trim();
        const pieces = crosses
          ? touched.map((sp) => joined.slice(Math.max(sp.s, d.start), Math.min(sp.e, d.end)).replace(/^[\s,;:]+|[\s,;:]+$/g, ''))
          : [];
        // Cada pedazo debe ser algo (3 letras o cifras): «Jiménez ¶ C.C.» no es un nombre partido.
        if (pieces.some((piece) => (piece.match(/[\p{L}\p{N}]/gu) || []).length < 3)) continue;
        out.push({ type: d.type, value, pieces });
      }
    }
    i = j + 1;
  }
  return out;
}

// Una pista que es una parte entera de otro dato (un fin de teléfono bajo «Cédula») se oculta como alias de ese dato.
function hostOfHint(list, h) {
  const v = h.value.trim();
  if (!v) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
  return list.find((e) => e.type !== h.type && e.type !== 'NOMBRE' && !e.weak && [e.value, ...e.aliases].some((s) => re.test(s))) || null;
}

export function buildEntities(paragraphs, { names = true, hints = [] } = {}) {
  const byKey = new Map();
  const list = [];
  const context = names ? buildNameContext(paragraphs.map((p) => p.text)) : null;
  for (const p of paragraphs) {
    if (!p.text.trim()) continue;
    for (const d of detect(p.text, context)) {
      const value = p.text.slice(d.start, d.end).trim();
      const key = normKey(value);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        // Un nombre visto primero con señal débil se confirma si luego aparece con señal fuerte.
        if (existing.weak && !d.weak) { delete existing.weak; existing.enabled = TYPE_BY_ID[existing.type].on; }
        if ((d.score || 0) > (existing.score || 0)) existing.score = d.score;
        if (d.personal) existing.enabled = true;
        continue;
      }
      const entity = createEntity(list, d.type, value);
      if (d.score !== undefined) entity.score = d.score;
      if (d.weak) { entity.weak = true; entity.enabled = false; }
      if (d.personal) entity.enabled = true;
      byKey.set(key, entity);
      list.push(entity);
    }
  }
  // Pistas de la maquetación (columnas de tablas, bloques de firma): datos que el texto solo no delata.
  for (const h of [...hints, ...signatureNames(paragraphs)]) {
    const key = normKey(h.value);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      // Una sugerencia débil o un «nombre propio» pasa a ser el dato que dice la maquetación.
      if ((existing.weak || existing.type === 'NOMBRE') && existing.type !== h.type) {
        existing.label = nextLabel(list.filter((e) => e !== existing), h.type);
        existing.type = h.type;
      }
      if (existing.weak) { delete existing.weak; existing.enabled = TYPE_BY_ID[existing.type].on; }
      if (existing.type === h.type) existing.enabled = TYPE_BY_ID[h.type].on || existing.enabled;
      continue;
    }
    const phoneHost = hostOfHint(list, h);
    if (phoneHost) {
      if (![phoneHost.value, ...phoneHost.aliases].some((v) => normKey(v) === key)) phoneHost.aliases.push(h.value);
      byKey.set(key, phoneHost);
      continue;
    }
    const entity = createEntity(list, h.type, h.value);
    entity.score = SCORES.layout;
    byKey.set(key, entity);
    list.push(entity);
  }
  for (const d of detectAcrossBreaks(paragraphs, context)) {
    const key = normKey(d.value);
    let entity = byKey.get(key);
    // Si un pedazo ya era un dato del mismo tipo, ese dato pasa a tener el valor completo y conserva su etiqueta.
    const host = !entity && d.pieces.map((piece) => byKey.get(normKey(piece))).find((o) => o && o.type === d.type && list.includes(o));
    if (host) {
      host.aliases.push(host.value);
      host.value = d.value;
      entity = host;
      byKey.set(key, entity);
    } else if (!entity) {
      entity = createEntity(list, d.type, d.value);
      byKey.set(key, entity);
      list.push(entity);
    }
    for (const piece of d.pieces) {
      const pieceKey = normKey(piece);
      if (pieceKey === normKey(entity.value) || entity.aliases.some((a) => normKey(a) === pieceKey)) continue;
      const other = byKey.get(pieceKey);
      if (other && other !== entity) {
        // El pedazo ya era un dato propio («RUBIELA ESPERANZA CORTÉS» en su párrafo): pasa a ser una variante del completo.
        if (other.type !== entity.type || !list.includes(other)) continue;
        entity.aliases.push(other.value, ...other.aliases.filter((a) => normKey(a) !== normKey(entity.value)));
        for (const v of [other.value, ...other.aliases]) byKey.set(normKey(v), entity);
        list.splice(list.indexOf(other), 1);
        continue;
      }
      entity.aliases.push(piece);
      byKey.set(pieceKey, entity);
    }
  }
  for (const e of list) {
    if (e.type !== 'EMPRESA' || !COMPANY_SUFFIX_AT_END.test(e.value)) continue;
    const short = e.value.replace(COMPANY_SUFFIX_AT_END, '').trim();
    if (short.length >= 6 && (!byKey.has(normKey(short)) || byKey.get(normKey(short)).type === 'NOMBRE')) {
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
  // El mismo nombre con las palabras en otro orden («CLARO JAIME KATIA ESTHER» en tablas) es una sola persona.
  const sortedWords = (e) => normKey(e.value).split(' ').sort().join(' ');
  for (const e of people) {
    if (merged.has(e) || normKey(e.value).split(' ').length < 2) continue;
    for (const o of people) {
      if (o === e || merged.has(o) || normKey(o.value) === normKey(e.value) || sortedWords(o) !== sortedWords(e)) continue;
      for (const v of [o.value, ...o.aliases]) if (!e.aliases.some((a) => normKey(a) === normKey(v)) && normKey(v) !== normKey(e.value)) e.aliases.push(v);
      e.enabled = e.enabled || o.enabled;
      merged.add(o);
    }
  }
  const rest = dropNamesCoveredByOthers(list.filter((e) => !merged.has(e)));
  addLoneMentions(rest, paragraphs, byKey);
  return mergeCueVariants(rest, byKey);
}

/**
 * Una palabra suelta de un nombre completo («Mendoza declaró», tras «Ana María Mendoza») también es de esa persona.
 * Las variantes se reemplazan en todo el documento, así que si la palabra es también una palabra común («Torres»,
 * «torres»), o puede ser de dos personas, o no hay lista de comunes, no se une sola: queda como una etiqueta
 * sin marcar para que el usuario decida. Solo cuenta si aparece suelta y con mayúscula.
 */
function addLoneMentions(rest, paragraphs, byKey) {
  const owners = new Map();
  for (const e of rest) {
    if (e.type !== 'PERSONA' || normKey(e.value).split(' ').length < 2) continue;
    for (const word of e.value.split(/\s+/)) {
      const key = normKey(word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''));
      if (key.length < 4 || CONNECTORS.has(key)) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(e);
    }
  }
  if (!owners.size) return;
  const taken = new Set();
  for (const e of rest) for (const v of [e.value, ...e.aliases]) taken.add(normKey(v));
  const otherWords = new Set();
  for (const e of rest) {
    if (e.type !== 'PERSONA') for (const w of normKey(e.value).split(' ')) otherWords.add(w);
  }
  // Todas las agujas van como activas: aquí solo importa qué tramo es el más largo, no si el usuario lo marcó.
  const needles = toNeedles(rest).map((n) => ({ ...n, enabled: true }));
  for (const [key, who] of owners) {
    if (taken.has(key) || otherWords.has(key)) continue;
    let hitText = null;
    for (const p of paragraphs) {
      if (!p.text) continue;
      for (const o of findOccurrences(p.text, [...needles, { id: '__lone', value: key, enabled: true }])) {
        if (o.id !== '__lone' || !/\p{Lu}/u.test(p.text[o.start])) continue;
        hitText = p.text.slice(o.start, o.end);
        break;
      }
      if (hitText) break;
    }
    if (!hitText) continue;
    const safe = COMMON_NOUNS.size > 0 && !COMMON_NOUNS.has(key) && !COMMON_LOWER_NAMES.has(key) && !AMBIGUOUS_FIRST_NAMES.has(key);
    if (who.size === 1 && safe) {
      const [owner] = who;
      owner.aliases.push(hitText);
      byKey.set(key, owner);
    } else {
      const it = createEntity(rest, 'PERSONA', hitText);
      it.weak = true;
      it.enabled = false;
      rest.push(it);
      byKey.set(key, it);
    }
  }
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
