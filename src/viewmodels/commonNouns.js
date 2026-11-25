// Carga única de la lista de palabras comunes (ADR-012) en el hilo principal. El cargador se importa cuando se
// necesita, como el del motor, para que no pese en el arranque.
import { setCommonNouns } from '../model/lexicon.js';

let loading = null;

/** Una sola promesa; resuelve con las palabras (vacío si no hay lista). El worker del expediente recibe la copia en su mensaje. */
export function ensureCommonNouns() {
  loading ||= import('../model/engine/loader.js').then(async ({ loadCommonNouns }) => {
    const words = await loadCommonNouns();
    setCommonNouns(words);
    return words;
  });
  return loading;
}
