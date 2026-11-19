// Pre-paso de la restauración desde PDF (ADR-003): pega etiquetas `[PERSONA_1]` cortadas por saltos de línea,
// guiones de fin de línea, espacios o guiones blandos, pero SOLO cuando el resultado es una clave del diccionario.
// Lo que parece una etiqueta rota y no coincide con ninguna clave se deja igual y se informa en `broken`.
// El texto sin corchetes, o con corchetes que no forman una clave, vuelve idéntico. Puro, no lanza.

const SOFT_HYPHEN = /­/g;
const SPAN = /\[[^[\]\n]{1,60}\]/g;
const OPEN_AT_END = /\[([^[\]]{0,59})\s*$/;
const LEADING_CLOSE = /^\s*([^[\]]{0,59})\]/;
const TAG_LIKE = /^[A-ZÁÉÍÓÚÑ0-9_ -]*$/;

const isKey = (dict, candidate) => Object.hasOwn(dict, candidate);
// Solo se informa como rota lo que parece etiqueta: letras mayúsculas, «_», dígitos. Un «[» suelto no (FIX-7).
const looksLikeTag = (inner) => /[A-ZÁÉÍÓÚÑ]/.test(inner) && TAG_LIKE.test(inner);

// Candidatas, de la más literal a la más permisiva: espacios colapsados, sin espacios, sin el guion de corte.
function candidates(raw) {
  const collapsed = raw.replace(/\s+/g, ' ');
  const noSpaces = raw.replace(/\s+/g, '');
  return [collapsed, noSpaces, noSpaces.replace(/-(?=[^\]]*\])/, '')];
}

function matchKey(dict, raw) {
  return candidates(raw).find((c) => isKey(dict, c));
}

function collapseInsideSpans(line, dict, state) {
  return line.replace(SPAN, (span) => {
    if (!/\s/.test(span)) return span;
    const key = matchKey(dict, span);
    if (!key) return span;
    state.joined++;
    return key;
  });
}

// Pega el fragmento abierto al final de la línea i con el comienzo de la i+1 si da una clave.
function joinAcrossLines(lines, i, dict, state) {
  const open = OPEN_AT_END.exec(lines[i]);
  if (!open || !TAG_LIKE.test(open[1].trim())) return false;
  const frag = `[${open[1].replace(/\s+$/, '')}`;
  const close = i + 1 < lines.length ? LEADING_CLOSE.exec(lines[i + 1]) : null;
  if (!close) {
    if (looksLikeTag(open[1].trim())) state.broken.add(frag);
    return false;
  }
  const joinedRaw = `${frag}${close[1]}]`;
  const key = candidates(joinedRaw).find((c) => isKey(dict, c));
  if (!key) {
    const piece = `${frag.replace(/-$/, '')}${close[1].trim()}]`;
    if (looksLikeTag(piece.slice(1, -1))) state.broken.add(piece);
    return false;
  }
  lines[i] = lines[i].slice(0, open.index) + key + lines[i + 1].slice(close[0].length);
  lines.splice(i + 1, 1);
  state.joined++;
  return true;
}

export function rejoinTags(text, dict) {
  const keys = dict ?? {};
  const state = { joined: 0, broken: new Set() };
  const source = String(text ?? '').replace(SOFT_HYPHEN, '');
  const lines = source.split('\n').map((line) => collapseInsideSpans(line, keys, state));
  for (let i = 0; i < lines.length; i++) {
    while (joinAcrossLines(lines, i, keys, state)) { /* una línea puede cerrar una etiqueta y abrir otra */ }
  }
  return { text: lines.join('\n'), joined: state.joined, broken: [...state.broken] };
}
