import { useEffect, useId, useRef, useState } from 'react';

// Diálogo nativo <dialog> para la contraseña de un PDF (C2, A1). La entrada no es controlada: su valor solo se lee
// al enviar, se borra de inmediato y nunca pasa por el estado de React (ADR-002). Sin name ni formulario: nada llega a la URL.
export default function PasswordDialog({ prompt, onSubmit, onCancel }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);
  const [empty, setEmpty] = useState(true);
  // «Mostrar» solo cambia cómo se ve la entrada; el valor sigue sin pasar por el estado. Cada apertura empieza oculta.
  const [shown, setShown] = useState(false);
  const [toggled, setToggled] = useState(false);
  const open = Boolean(prompt);
  const checking = Boolean(prompt?.checking);
  const id = useId();
  const fileId = `${id}-file`, noteId = `${id}-note`, errorId = `${id}-error`, inputId = `${id}-input`;

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
      setShown(false);
      setToggled(false);
    }
  }, [open]);

  // Cada pregunta nueva empieza vacía, también si reemplaza a otra sin que el diálogo llegue a cerrarse (React puede
  // juntar el cierre y la nueva apertura en un solo render): nunca se envía lo escrito para otro archivo.
  useEffect(() => {
    clearInput();
  }, [prompt?.attempt]);

  // El foco nunca se pierde: en la entrada al preguntar, en «Cancelar» mientras la entrada está desactivada.
  useEffect(() => {
    if (!open) return;
    if (checking) cancelRef.current?.focus();
    else inputRef.current?.focus();
  }, [open, checking, prompt?.attempt]);

  useEffect(() => () => clearInput(), []);

  // Sin <form>: no hay evento submit que un gestor de contraseñas use para ofrecer guardarla (S1).
  const submitNow = () => {
    if (checking) return;
    const value = inputRef.current?.value ?? '';
    if (!value) return;
    clearInput();
    onSubmit(value);
  };

  const handleInputKeyDown = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submitNow();
  };

  // Cancelar y Escape funcionan siempre, también en «Comprobando…». Escape se atiende en keydown (el navegador
  // entonces no lanza «cancel») y el evento «cancel» queda para otras vías de cierre nativas; onCancel es idempotente.
  const handleCancel = (event) => {
    event.preventDefault();
    clearInput();
    onCancel();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') handleCancel(event);
  };

  const toggleShown = () => {
    setShown((s) => !s);
    setToggled(true);
  };

  const incorrect = prompt?.reason === 'incorrect' && !checking;
  const status = checking ? 'Comprobando la contraseña…'
    : toggled ? (shown ? 'La contraseña se ve en pantalla' : 'La contraseña está oculta') : '';

  return (
    <dialog ref={dialogRef} className="pw-dialog" aria-label="Contraseña del PDF" aria-describedby={`${fileId} ${noteId}`}
      onCancel={handleCancel} onKeyDown={handleKeyDown}>
      {open && (
        <div className="pw-form">
          <h2 className="pw-h">Este PDF tiene contraseña</h2>
          <p className="pw-file" id={fileId}>{prompt.fileName.trim() || 'Archivo PDF'}</p>
          <label className="pw-label" htmlFor={inputId}>Contraseña</label>
          <div className="pw-field">
            <input ref={inputRef} id={inputId} type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false}
              autoCapitalize="off" autoCorrect="off"
              data-1p-ignore="" data-lpignore="true" data-bwignore="" onKeyDown={handleInputKeyDown}
              aria-invalid={incorrect || undefined} aria-describedby={incorrect ? errorId : undefined}
              disabled={checking} onInput={(e) => setEmpty(e.currentTarget.value === '')} />
            <button type="button" className="btn pw-toggle" aria-controls={inputId} onClick={toggleShown}>
              {shown ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {incorrect && <p className="pw-error" id={errorId} role="alert">Contraseña incorrecta</p>}
          <p className="pw-note" id={noteId}>Solo se usa para abrir el archivo en este computador. No se guarda ni se envía.</p>
          <p className="pw-sr" role="status">{status}</p>
          <div className="pw-actions">
            <button ref={cancelRef} type="button" className="btn ghost" onClick={handleCancel}>Cancelar</button>
            <button type="button" className="btn primary" onClick={submitNow} disabled={empty || checking}>
              {checking ? 'Comprobando…' : 'Abrir'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
