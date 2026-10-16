// Trabajo pesado del modo expediente. Corre en un Web Worker para no congelar la pantalla con 600 folios;
// si el navegador no tiene workers (pruebas), se llama directamente.
import { buildEntities } from '../model/index.js';
import { buildDocument, buildDocxDocument, anonymizeTexts, findOcrVariants, tidyEntities } from '../model/expediente/index.js';

const now = () => performance.now();

/** Desde un PDF ({ pages }) o desde los párrafos de un Word ({ paragraphs }). */
function prepare({ pages, paragraphs }) {
  let t = now();
  const build = pages ? (opts) => buildDocument(pages, opts) : (opts) => buildDocxDocument(paragraphs, opts);
  const full = build();
  const reduced = build({ reduce: true });
  const layoutMs = now() - t;
  t = now();
  // La versión completa ya une los párrafos que cruzan de folio y conserva encabezados: ve todos los datos.
  const entities = tidyEntities(buildEntities(full.paragraphs));
  return { full, reduced, entities, layoutMs, detectMs: now() - t };
}

function apply({ texts, entities }) {
  const t = now();
  const applied = anonymizeTexts(texts, entities);
  const applyMs = now() - t;
  const t2 = now();
  const variants = findOcrVariants(texts, entities);
  return { ...applied, variants, applyMs, variantsMs: now() - t2 };
}

const TASKS = { prepare, apply };

export function runTask(op, payload) {
  const task = TASKS[op];
  if (!task) throw new Error(`Tarea desconocida: ${op}`);
  return task(payload);
}
