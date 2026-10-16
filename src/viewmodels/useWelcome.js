import { useCallback, useMemo, useState } from 'react';

const DEFAULT_OUTPUT = 'parts';

/**
 * Pasos: 'start' (¿qué desea hacer?) → 'length' (¿qué tan largo?) → 'short' o 'long' (elegir documento).
 * No se guarda nada entre visitas: cada documento empieza la guía desde cero.
 */
export function useWelcome({ openShort, openLong, showExample, goRestore, goTools }) {
  const [history, setHistory] = useState(['start']);
  const [output, setOutput] = useState(DEFAULT_OUTPUT);
  const step = history[history.length - 1];

  const go = useCallback((next) => setHistory((h) => [...h, next]), []);
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);
  const restart = useCallback(() => { setHistory(['start']); setOutput(DEFAULT_OUTPUT); }, []);

  const actions = useMemo(() => ({
    protect: () => go('length'),
    restore: goRestore,
    chooseLength: go,
    chooseOutput: setOutput,
    back,
    restart,
    skip: goTools
  }), [go, back, restart, goRestore, goTools]);

  const openFile = useCallback((file) => {
    if (!file) return;
    if (step === 'long' || /\.pdf$/i.test(file.name)) openLong(file, step === 'long' ? output : 'one');
    else openShort(file);
  }, [step, output, openLong, openShort]);

  return { step, canGoBack: history.length > 1, output, actions, openFile, showExample };
}
