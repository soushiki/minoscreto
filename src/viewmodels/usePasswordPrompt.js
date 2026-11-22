import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Una sola pregunta de contraseña pendiente a la vez (C2, ADR-002).
 *
 * askPassword({ fileName, reason: 'need'|'incorrect'|'layout', signal }) abre el diálogo y responde con lo escrito o con
 * null (Cancelar, Escape, signal cancelado, otra pregunta nueva o el componente desmontado). Se entrega tal cual
 * al onPassword de pdf.js (readPdfPages). 'layout': se pide otra vez para hacer el PDF con diseño (ADR-007).
 *
 * El estado solo guarda { fileName, reason, attempt, checking }: nunca la contraseña. Tras responder, el diálogo
 * sigue abierto en «Comprobando…» hasta que pdf.js vuelva a preguntar (contraseña incorrecta), el signal se cancele
 * o el llamador cierre con close() al terminar la lectura, para que un error se vea en el mismo diálogo.
 *
 * Cancelar en «Comprobando…» también cancela de verdad: si pdf.js vuelve a preguntar en esa misma lectura (mismo
 * signal) recibe null sin abrir el diálogo, y onCancel avisa al llamador para que corte la lectura aunque la
 * contraseña fuera correcta.
 */
export function usePasswordPrompt({ onCancel } = {}) {
  const [prompt, setPrompt] = useState(null);
  const pending = useRef(null);
  const detachAbort = useRef(null);
  const attempts = useRef(0); // nunca vuelve a 0: cada pregunta nueva tiene su número y el diálogo vacía la entrada
  const checking = useRef(false);
  const readKey = useRef(null);
  const dismissedKey = useRef(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

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
    checking.current = false;
    readKey.current = null;
    dismissedKey.current = null;
    setPrompt(null);
  }, [settle, stopListening]);

  const askPassword = useCallback(({ fileName = '', reason = 'need', signal } = {}) => new Promise((resolve) => {
    // Sin signal no se distingue una nueva pregunta de la misma lectura de un archivo nuevo: entonces no se recuerda
    // la cancelación (el diálogo reabre) y solo onCancel avisa. Los llamadores (T8, T10) siempre pasan signal.
    const key = signal ?? null;
    const dismissed = dismissedKey.current;
    dismissedKey.current = null;
    if (key !== null && dismissed === key) { resolve(null); return; }
    settle(null);
    stopListening();
    if (signal?.aborted) { resolve(null); close(); return; }
    if (signal) {
      const onAbort = () => close();
      signal.addEventListener('abort', onAbort, { once: true });
      detachAbort.current = () => signal.removeEventListener('abort', onAbort);
    }
    pending.current = resolve;
    readKey.current = key;
    checking.current = false;
    attempts.current += 1;
    setPrompt({
      fileName: String(fileName),
      reason: reason === 'incorrect' || reason === 'layout' ? reason : 'need',
      attempt: attempts.current,
      checking: false,
    });
  }), [settle, stopListening, close]);

  const submit = useCallback((password) => {
    if (typeof password !== 'string' || password === '' || !pending.current) return;
    checking.current = true;
    setPrompt((p) => (p ? { ...p, checking: true } : p));
    settle(password);
  }, [settle]);

  // Siempre cierra, también en «Comprobando…»: el usuario nunca queda atrapado ni ve reaparecer el diálogo.
  const cancel = useCallback(() => {
    const wasOpen = pending.current !== null || checking.current;
    const key = checking.current ? readKey.current : null;
    close();
    if (key !== null) dismissedKey.current = key;
    if (wasOpen && onCancelRef.current) onCancelRef.current();
  }, [close]);

  useEffect(() => () => { settle(null); stopListening(); }, [settle, stopListening]);

  return { prompt, askPassword, submit, cancel, close };
}
