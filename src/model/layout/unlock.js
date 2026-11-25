// Quita la contraseña de usuario de un PDF una sola vez, justo después de que pdf.js la aceptó (ADR-009; ADR-002).
// Abre los bytes con el motor, los guarda sin seguridad y cierra. La copia sin clave queda solo en memoria y el PDF
// con diseño ya no pregunta de nuevo. La contraseña vive en estos argumentos hasta que termina: no se guarda en
// ningún otro sitio. Si algo falla, quien llama sigue con el camino de ADR-007 (pedirla al descargar).
import { loadEngine as defaultLoadEngine } from '../engine/loader.js';
import { inTurn } from './turns.js';

/**
 * @param {{ bytes: Uint8Array, password: string, loadEngine?: () => Promise<object>, signal?: AbortSignal }} options
 * @returns {Promise<Uint8Array>} el mismo PDF sin contraseña.
 */
export function unlockPdf({ bytes, password, loadEngine = defaultLoadEngine, signal }) {
  // El worker guarda un solo documento abierto: se turna con protect y restore (turns.js).
  return inTurn(async () => {
    const client = await loadEngine();
    await client.open(bytes.slice(), password);
    try {
      return await client.save();
    } finally {
      await client.close().catch(() => {});
    }
  }, signal);
}
