import { useLayoutEffect, useRef } from 'react';
import { BrandMark, DownloadIcon, LockIcon } from '../components/Icons.jsx';

export default function Header({ screen, onScreen, onHome, anonymizer }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const measure = () => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const nothing = anonymizer.replacements === 0;

  return (
    <header className="top" ref={ref}>
      <div className="wrap topin">
        <button type="button" className="brand" onClick={onHome} title="Volver al inicio" aria-label="Minoscreto, volver al inicio"><BrandMark /><span>Minoscreto</span></button>
        <nav className="tabs" aria-label="Secciones">
          <button type="button" className={`tab${screen === 'anonymize' ? ' on' : ''}`} onClick={() => onScreen('anonymize')}>Anonimizar</button>
          <button type="button" className={`tab${screen === 'expediente' ? ' on' : ''}`} onClick={() => onScreen('expediente')}>Expediente</button>
          <button type="button" className={`tab${screen === 'restore' ? ' on' : ''}`} onClick={() => onScreen('restore')}>Restaurar nombres</button>
        </nav>
        <span className="priv"><LockIcon />Tu documento se procesa en este navegador y no se sube a ningún servidor</span>
        {screen === 'anonymize' && (
          <div className="acts">
            <button type="button" className="btn ghost" disabled={!anonymizer.canUndo} onClick={anonymizer.actions.undo} title="Deshacer (Ctrl+Z)">Deshacer</button>
            <button type="button" className="btn ghost" disabled={!anonymizer.canRedo} onClick={anonymizer.actions.redo} title="Rehacer">Rehacer</button>
            <button type="button" className="btn" disabled={nothing} onClick={() => anonymizer.downloadDictionary(false)} title="Guarda las llaves y valores originales para restaurarlos después">
              <DownloadIcon />Diccionario
            </button>
            <button type="button" className="btn ghost" disabled={nothing} onClick={() => anonymizer.downloadDictionary(true)} title="Guardar el diccionario como texto simple LLAVE: VALOR">.txt</button>
            <button type="button" className="btn primary" disabled={nothing} onClick={anonymizer.downloadDocx}>
              <DownloadIcon />Descargar Word anonimizado
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
