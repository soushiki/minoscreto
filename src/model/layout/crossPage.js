// Datos partidos por un salto de folio (T12c). El motor edita una página a la vez y no ve un valor que empieza al
// final de una y sigue en la siguiente. Aquí se localizan esos valores en el texto ya unido (buildDocument anota
// dónde se unió cada folio: `joins`) y se devuelve, por página, el trozo que le toca borrar:
// el del folio anterior con la etiqueta (edge 'end'), el del siguiente sin etiqueta (edge 'start').
// Un valor que cruza dos o más saltos no se toca: la verificación final lo rechaza.
import { findOccurrences } from '../text.js';

const CONTEXT_CHARS = 24;

/**
 * @param {{ text: string, joins?: { at: number, page: number }[] }[]} paragraphs de buildDocument
 * @param {{ value: string, put: string }[]} needles las mismas agujas de protect.js
 * @returns {Map<number, { value: string, put: string, edge: 'end' | 'start' }[]>} por página (desde 0)
 */
export function crossPagePieces(paragraphs, needles) {
  const pieces = new Map();
  const seen = new Set();
  const add = (index, id, piece) => {
    const key = `${index}|${id}|${piece.edge}|${piece.put}|${piece.context}|${piece.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!pieces.has(index)) pieces.set(index, []);
    pieces.get(index).push(piece);
  };
  const list = needles.map((n, id) => ({ id, value: n.value.replace(/\s+/g, ' ').trim() }));
  for (const paragraph of paragraphs) {
    if (!paragraph.joins?.length) continue;
    const { text } = paragraph;
    for (const found of findOccurrences(text, list)) {
      const crossed = paragraph.joins.filter((j) => found.start < j.at && j.at < found.end);
      if (crossed.length !== 1) continue; // 0: no cruza; 2 o más: lo rechaza la verificación
      const [join] = crossed;
      const head = text.slice(found.start, join.at).trim();
      const tail = text.slice(join.at, found.end).trim();
      if (!head || !tail) continue;
      // Contexto: el texto del mismo folio pegado al trozo (hasta el salto de folio vecino, a lo más CONTEXT_CHARS).
      const before = Math.max(0, ...paragraph.joins.map((j) => j.at).filter((at) => at < found.start));
      const after = Math.min(text.length, ...paragraph.joins.map((j) => j.at).filter((at) => at > join.at));
      const headContext = text.slice(before, found.start).slice(-CONTEXT_CHARS).trim();
      const tailContext = text.slice(found.end, after).slice(0, CONTEXT_CHARS).trim();
      add(join.page - 2, found.id, { value: head, put: needles[found.id].put, edge: 'end', context: headContext });
      add(join.page - 1, found.id, { value: tail, put: '', edge: 'start', context: tailContext });
    }
  }
  return pieces;
}
