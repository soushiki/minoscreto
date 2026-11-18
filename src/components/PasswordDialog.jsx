import { useEffect, useId, useRef, useState } from 'react';

// Diálogo nativo <dialog> para la contraseña de un PDF (C2, A1). La entrada no es controlada: su valor solo se lee
// al enviar, se borra de inmediato y nunca pasa por el estado de React (ADR-002). Sin name ni action: nada llega a la URL.
export default function PasswordDialog({ prompt, onSubmit, onCancel }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);
  const [empty, setEmpty] = useState(true);
  const open = Boolean(prompt);
  const checking = Boolean(prompt?.checking);
  const id = useId();
  const fileId = `${id}-file`, noteId = `${id}-note`, errorId = `${id}-error`;

  const clearInput = () => {
    if (inputRef.current) inputRef.current.value = '';
    setEmpty(true);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open) {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      dialog.removeAttribute('open');
      clearInput();
    }
  }, [open]);

  // El foco nunca se pierde: en la entrada al preguntar, en «Cancelar» mientras la entrada está desactivada.
  useEffect(() => {
    if (!open) return;
    if (checking) cancelRef.current?.focus();
    else inputRef.current?.focus();
  }, [open, checking, prompt?.attempt]);

  useEffect(() => () => clearInput(), []);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (checking) return;
    const value = inputRef.current?.value ?? '';
    if (!value) return;
    clearInput();
    onSubmit(value);
  };

  // Cancelar y Escape funcionan siempre, también en «Comprobando…». Escape se atiende en keydown (el navegador
  // entonces no lanza «cancel») y el evento «cancel» queda para otras vías de cierre nativas; onCancel es idempotente.
  const handleCancel = (event) => {
    event.preventDefault();
    onCancel();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') handleCancel(event);
  };

  const incorrect = prompt?.reason === 'incorrect' && !checking;

  return (
    <dialog ref={dialogRef} className="pw-dialog" aria-label="Contraseña del PDF" aria-describedby={`${fileId} ${noteId}`}
      onCancel={handleCancel} onKeyDown={handleKeyDown}>
      {open && (
        <form className="pw-form" onSubmit={handleSubmit} noValidate>
          <h2 className="pw-h">Este PDF tiene contraseña</h2>
          <p className="pw-file" id={fileId}>{prompt.fileName || 'Archivo PDF'}</p>
          <label className="pw-label">
            Contraseña
            <input ref={inputRef} type="password" autoComplete="off" spellCheck={false} autoCapitalize="off"
              aria-invalid={incorrect || undefined} aria-describedby={incorrect ? errorId : undefined}
              disabled={checking} onInput={(e) => setEmpty(e.currentTarget.value === '')} />
          </label>
          {incorrect && <p className="pw-error" id={errorId} role="alert">Contraseña incorrecta</p>}
          <p className="pw-note" id={noteId}>Solo se usa para abrir el archivo en este computador. No se guarda ni se envía.</p>
          <div className="pw-actions">
            <button ref={cancelRef} type="button" className="btn ghost" onClick={handleCancel}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={empty || checking}>
              {checking ? 'Comprobando…' : 'Abrir'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
