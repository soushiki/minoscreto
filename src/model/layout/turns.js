// Turnos del worker (T10, T13): el motor guarda un solo documento abierto, así que proteger y restaurar
// (varias llamadas, doble clic) pasan por UNA cola.
const abortError = (signal) => signal.reason ?? new DOMException('Cancelado', 'AbortError');

let queue = Promise.resolve();

/** Ejecuta `run` cuando le toca. Cancelar mientras espera responde ya; el turno, al llegar, sale en su primer checkAbort. */
export function inTurn(run, signal) {
  const turn = queue.then(run);
  queue = turn.catch(() => {});
  if (!signal) return turn;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {});
  // Una señal que dura mucho (reusada en varias descargas) no acumula oyentes.
  return Promise.race([turn, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}
