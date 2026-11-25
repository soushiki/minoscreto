// Reconstruye líneas y párrafos a partir de la capa de texto de un PDF (por ejemplo, la que deja el OCR de Acrobat).

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/** Celdas de una línea: fragmentos separados por un hueco ancho (más de dos caracteres), como las columnas de una tabla. */
function lineCells(parts, h) {
  const cells = [];
  for (const p of parts) {
    if (!p.str.trim()) continue;
    const last = cells[cells.length - 1];
    if (last && p.x - last.right <= h * 2) {
      last.text = `${last.text} ${p.str}`.replace(/\s+/g, ' ').trim();
      last.right = Math.max(last.right, p.x + p.w);
    } else {
      cells.push({ text: p.str.trim(), x: p.x, right: p.x + p.w });
    }
  }
  return cells;
}

/** Agrupa los fragmentos de texto de pdf.js (getTextContent().items) en líneas con su posición. */
export function itemsToLines(items) {
  const lines = [];
  let current = null;
  let endLine = false;
  const close = () => {
    if (!current) return;
    current.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let prev = null;
    for (const p of current.parts) {
      if (prev) {
        const gap = p.x - (prev.x + prev.w);
        const spaced = /\s$/.test(text) || /^\s/.test(p.str);
        if (!spaced && gap > current.h * 0.15) text += ' ';
      }
      text += p.str;
      prev = p;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) {
      const first = current.parts[0];
      const last = current.parts[current.parts.length - 1];
      lines.push({ text, x: first.x, y: current.y, h: current.h, right: last.x + last.w, cells: lineCells(current.parts, current.h) });
    }
    current = null;
  };

  for (const item of items) {
    const str = item.str ?? '';
    const t = item.transform || [1, 0, 0, 1, 0, 0];
    const h = Math.hypot(t[2], t[3]) || item.height || 10;
    const part = { str, x: t[4], y: t[5], w: item.width || 0 };
    if (str.trim()) {
      if (current && (endLine || Math.abs(part.y - current.y) > Math.max(current.h, h) * 0.5)) close();
      if (!current) current = { parts: [], y: part.y, h };
      current.parts.push(part);
      current.h = Math.max(current.h, h);
      endLine = false;
    }
    if (item.hasEOL) endLine = true;
  }
  close();
  return lines;
}

const isFormLabel = (l) => {
  const t = (l.text || '').trim();
  return t.length <= 40 && /^\p{L}[^\d]*:$/u.test(t);
};

/**
 * Une cada etiqueta de formulario («Nombre:») con el valor que tiene al lado en la misma fila, aunque pdf.js los entregue
 * por separado (los valores de una columna antes que las etiquetas). Devuelve líneas nuevas; la unión queda en el lugar
 * de la etiqueta y marcada con `pair: true`. Lo que no tiene pareja queda igual y en su orden.
 */
export function joinFormPairs(lines) {
  const labels = new Set();
  lines.forEach((l, i) => { if (isFormLabel(l)) labels.add(i); });
  const used = new Set();
  const merged = new Map();
  for (const i of labels) {
    const label = lines[i];
    if (![label.x, label.y, label.h, label.right].every(Number.isFinite)) continue;
    let best = -1;
    let bestGap = Infinity;
    lines.forEach((v, j) => {
      if (j === i || labels.has(j) || used.has(j) || !(v.text || '').trim()) return;
      if (![v.x, v.y, v.h].every(Number.isFinite)) return;
      const gap = v.x - label.right;
      if (Math.abs(v.y - label.y) > Math.max(label.h, v.h) * 0.5 || gap < 0 || gap > label.h * 12) return;
      if (gap < bestGap) { best = j; bestGap = gap; }
    });
    if (best < 0) continue;
    const value = lines[best];
    used.add(best);
    merged.set(i, {
      text: `${label.text} ${value.text}`, x: label.x, y: label.y, h: Math.max(label.h, value.h), right: value.right,
      ...(label.cells || value.cells ? { cells: [...(label.cells || []), ...(value.cells || [])] } : {}),
      pair: true
    });
  }
  return lines.flatMap((l, i) => (used.has(i) ? [] : [merged.get(i) || l]));
}

const ROMAN = '[IVXLCDM]{1,7}';
const ORDINAL = 'PRIMER[OA]?|SEGUND[OA]|TERCER[OA]?|CUART[OA]|QUINT[OA]|SEXT[OA]|S[EÉ]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[EÉ]CIM[OA]|[ÚU]NIC[OA]';
const KEYWORD = new RegExp(`^(?:CAP[IÍ]TULO|T[IÍ]TULO|SECCI[OÓ]N|CL[AÁ]USULA|ART[IÍ]CULO)\\s+(?:${ROMAN}|\\d{1,3}[A-Z]?|${ORDINAL})\\b`, 'iu');
const SECTION_UPPER = /^(?:CONSIDERANDOS?|CONSIDERACIONES(?: DEL DESPACHO| DE LA SALA)?|RESUELVE|RESUELVEN|DECIDE|FALLA|ANTECEDENTES|HECHOS|PRETENSIONES|PRUEBAS|FUNDAMENTOS(?: DE DERECHO)?|PROBLEMA JUR[IÍ]DICO|DECISI[OÓ]N|PARTE (?:MOTIVA|RESOLUTIVA)|SENTENCIA)\b/u;
const SECTION_ALONE = /^(?:Considerandos?|Consideraciones|Resuelve|Antecedentes|Hechos|Pretensiones|Pruebas|Decisión|Problema jurídico)\s*[:.]?$/u;
const NUMBERED = new RegExp(`^(?:\\d{1,2}(?:\\.\\d{1,2}){0,3}\\.?|${ROMAN}\\.)\\s+(\\S.*)$`, 'u');

const upperRatio = (s) => {
  const letters = s.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  return letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / letters.length;
};

/** ¿Es un título de sección (CAPÍTULO, CLÁUSULA, CONSIDERANDOS, RESUELVE, «2.1 Hechos»…)? */
export function isHeading(text) {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  if (KEYWORD.test(t) && /^\p{Lu}/u.test(t)) return true;
  if (SECTION_UPPER.test(t) || SECTION_ALONE.test(t)) return true;
  const m = NUMBERED.exec(t);
  if (m) {
    const rest = m[1];
    if (!/^\p{Lu}/u.test(rest)) return false;
    if (upperRatio(rest) > 0.7) return true;
    return rest.length <= 60 && !/[.;,]$/.test(rest);
  }
  return false;
}

const LIST_START = /^(?:\d{1,3}[.)]|[a-zñ][.)]|[-•–·]|[IVXLC]{1,6}[.)])\s/u;
const ENDS_SENTENCE = /[.:;!?»”"]$/;
const SOFT_HYPHEN_END = /\p{L}[-‐¬­]$/u;
const STARTS_LOWER = /^\p{Ll}/u;

/** Une dos trozos de un mismo párrafo, quitando el guion de corte si la palabra sigue en minúscula. */
export const joinText = (a, b) => (SOFT_HYPHEN_END.test(a) && STARTS_LOWER.test(b) ? a.slice(0, -1) + b : `${a} ${b}`);

/** ¿El último párrafo de un folio sigue en el siguiente? (no termina en puntuación y lo que sigue no es título ni viñeta) */
export const continuesOnNextPage = (last, first) =>
  !/[.:;!?»”")\]]$/.test(last) && !isHeading(last) && !isHeading(first) && !LIST_START.test(first);

/**
 * Une líneas en párrafos: corta en saltos verticales grandes, títulos, viñetas y líneas cortas con punto final;
 * quita el guion de fin de línea cuando la palabra sigue en minúscula.
 * Acepta líneas con posición ({ text, x, y, h, right }) o solo texto (cadenas).
 * Con `flags` devuelve { text, pair } (pair: viene de una etiqueta y su valor); sin él, cadenas.
 */
export function linesToParagraphs(input, { flags = false } = {}) {
  const lines = input.map((l) => (typeof l === 'string' ? { text: l } : l));
  const geo = lines.filter((l) => l.text && Number.isFinite(l.y));
  const hasGeo = geo.length >= 2 && geo.length === lines.filter((l) => l.text).length;
  let spacing = 0;
  let left = 0;
  let right = 0;
  let lineH = 10;
  if (hasGeo) {
    const steps = [];
    for (let i = 1; i < geo.length; i++) {
      const d = geo[i - 1].y - geo[i].y;
      if (d > 0) steps.push(d);
    }
    spacing = median(steps);
    left = percentile(geo.map((l) => l.x), 0.1);
    right = percentile(geo.map((l) => l.right), 0.9);
    lineH = median(geo.map((l) => l.h)) || 10;
  }
  const width = right - left;
  const typicalLength = median(lines.filter((l) => l.text).map((l) => l.text.length));

  const isShort = (l) => (hasGeo && width > 0 ? l.right < right - width * 0.12 : l.text.length < typicalLength * 0.8);
  const isIndented = (l) => hasGeo && l.x > left + lineH * 1.2;
  const headingLine = (l) => isHeading(l.text) && (upperRatio(l.text) > 0.7 || (hasGeo ? isShort(l) : l.text.length <= 70));

  const paragraphs = [];
  let text = '';
  let prev = null;
  let pair = false;
  const flush = () => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean) paragraphs.push(flags ? { text: clean, pair } : clean);
    text = '';
  };

  for (const line of lines) {
    const t = (line.text || '').replace(/\s+/g, ' ').trim();
    if (!t) { flush(); prev = null; continue; }
    const cur = { ...line, text: t };
    if (prev) {
      let breaks = headingLine(prev) || headingLine(cur) || LIST_START.test(t) || prev.pair || cur.pair;
      if (!breaks && hasGeo && Number.isFinite(prev.y) && Number.isFinite(cur.y)) {
        const d = prev.y - cur.y;
        if (d < 0 || (spacing > 0 && d > spacing * 1.45)) breaks = true;
      }
      if (!breaks && ENDS_SENTENCE.test(prev.text) && (isShort(prev) || isIndented(cur))) breaks = true;
      if (breaks) flush();
    }
    if (!text) pair = !!cur.pair;
    text = text ? joinText(text, t) : t;
    prev = cur;
  }
  flush();
  return paragraphs;
}
