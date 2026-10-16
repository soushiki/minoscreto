// Abre un Word para el modo expediente (en el hilo principal: usa DOMParser) y lo deja como datos simples
// que se pueden pasar al worker.
import { openDocx, partLabel } from '../docx/package.js';

const kindOf = (path) => {
  if (/document\.xml$/.test(path)) return 'main';
  if (/header|footer/.test(path)) return 'furniture';
  return 'note';
};

export async function readDocxParagraphs(buffer) {
  const doc = await openDocx(buffer);
  return {
    paragraphs: doc.paragraphs.map((p) => ({ text: p.text, kind: kindOf(p.part), label: partLabel(p.part), breaks: p.breaks || [] })),
    warnings: doc.warnings
  };
}
