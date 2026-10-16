import { replaceInString } from './text.js';
import { partLabel } from './docx/package.js';

/**
 * Texto anonimizado de un Word, listo para pegar en la IA: un párrafo por bloque, con las mismas
 * etiquetas que el .docx descargado. Encabezados, pies y notas llevan delante su nombre.
 */
export function anonymizedText(paragraphs, analysis, entities) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out = [];
  paragraphs.forEach((p, pi) => {
    if (!p.text.trim()) return;
    const ranges = analysis.occurrences[pi]
      .filter((o) => o.replaced)
      .map((o) => ({ start: o.start, end: o.end, text: `[${byId.get(o.id).label}]` }));
    const text = replaceInString(p.text, ranges).replace(/\s+/g, ' ').trim();
    const label = partLabel(p.part);
    out.push(label ? `${label}: ${text}` : text);
  });
  return out.join('\n\n') + '\n';
}
