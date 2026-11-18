import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Una sola pregunta de contraseña pendiente a la vez (C2, ADR-002).
 *
 * askPassword({ fileName, reason: 'need'|'incorrect', signal }) abre el diálogo y responde con lo escrito o con
 * null (Cancelar, Escape, signal cancelado, otra pregunta nueva o el componente desmontado). Se entrega tal cual
 * al onPassword de pdf.js (readPdfPages).
 *
 * El estado solo guarda { fileName, reason, attempt, checking }: nunca la contraseña. Tras responder, el diálogo
 * sigue abierto en «Comprobando…» hasta que pdf.js vuelva a preguntar (contraseña incorrecta), el signal se cancele
 * o el llamador cierre con close() al terminar la lectura, para que un error se vea en el mismo diálogo.
 */
export function usePasswordPrompt() {
  const [prompt, setPrompt] = useState(null);
  const pending = useRef(null);
  const detachAbort = useRef(null);
  const attempts = useRef(0);

  const settle = useCallback((answer) => {
    const resolve = pending.current;
    pending.current = null;
    if (resolve) resolve(answer);
  }, []);

  const stopListening = useCallback(() => {
    if (detachAbort.current) detachAbort.current();
    detachAbort.current = null;
  }, []);

  const close = useCallback(() => {
    settle(null);
    stopListening();
    attempts.current = 0;
    setPrompt(null);
  }, [settle, stopListening]);

  const askPassword = useCallback(({ fileName = '', reason = 'need', signal } = {}) => new Promise((resolve) => {
    settle(null);
    stopListening();
    if (signal?.aborted) { resolve(null); close(); return; }
    if (signal) {
      const onAbort = () => close();
      signal.addEventListener('abort', onAbort, { once: true });
      detachAbort.current = () => signal.removeEventListener('abort', onAbort);
    }
    pending.current = resolve;
    attempts.current += 1;
    setPrompt({
      fileName: String(fileName),
      reason: reason === 'incorrect' ? 'incorrect' : 'need',
      attempt: attempts.current,
      checking: false,
    });
  }), [settle, stopListening, close]);

  const submit = useCallback((password) => {
    if (typeof password !== 'string' || password === '' || !pending.current) return;
    setPrompt((p) => (p ? { ...p, checking: true } : p));
    settle(password);
  }, [settle]);

  // Siempre cierra, también en «Comprobando…»: si el llamador olvidara close(), el usuario no queda atrapado.
  const cancel = useCallback(() => close(), [close]);

  useEffect(() => () => { settle(null); stopListening(); }, [settle, stopListening]);

  return { prompt, askPassword, submit, cancel, close };
}
