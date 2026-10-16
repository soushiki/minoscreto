import { useCallback, useMemo, useState } from 'react';

const KEY = 'minoscreto.guia';

// Lo recordado es solo una comodidad: si el navegador no deja guardar, la guía funciona igual.
export function readGuidePrefs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    return prefs && typeof prefs === 'object' ? prefs : {};
  } catch {
    return {};
  }
}

function writeGuidePrefs(change) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readGuidePrefs(), ...change }));
  } catch {
    // Sin almacenamiento disponible (ventana privada, permisos): no pasa nada.
  }
}

/** Pasos: 'start' (¿qué desea hacer?) → 'length' (¿qué tan largo?) → 'short' o 'long' (elegir documento). */
export function useWelcome({ openShort, openLong, showExample, goRestore, goTools }) {
  const [prefs, setPrefs] = useState(readGuidePrefs);
  const [history, setHistory] = useState(['start']);
  const step = history[history.length - 1];
  const output = prefs.output === 'one' ? 'one' : 'parts';

  const remember = useCallback((change) => {
    writeGuidePrefs(change);
    setPrefs((p) => ({ ...p, ...change }));
  }, []);

  const go = useCallback((next) => setHistory((h) => [...h, next]), []);
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);
  const restart = useCallback(() => setHistory(['start']), []);

  const actions = useMemo(() => ({
    protect: () => go('length'),
    restore: () => { remember({ skip: false }); goRestore(); },
    chooseLength: (length) => { remember({ length }); go(length); },
    chooseOutput: (value) => remember({ output: value }),
    back,
    restart,
    skip: () => { remember({ skip: true }); goTools(); }
  }), [go, back, restart, remember, goRestore, goTools]);

  const openFile = useCallback((file) => {
    if (!file) return;
    remember({ skip: false });
    if (step === 'long' || /\.pdf$/i.test(file.name)) openLong(file, step === 'long' ? output : 'one');
    else openShort(file);
  }, [step, output, openLong, openShort, remember]);

  return {
    step, canGoBack: history.length > 1, lastLength: prefs.length || null, output,
    actions, openFile, showExample
  };
}
