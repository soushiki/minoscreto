import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { buildDocx, DOCX_MIME, readDictionaryFrom, restoreDocx, restoreText } from '../model/index.js';

export function useRestorer({ save, notify }) {
  const [dictionary, setDictionary] = useState(null);
  const [dictionaryName, setDictionaryName] = useState('');
  const [mode, setMode] = useState('paste');
  const [pasted, setPasted] = useState('');
  const [word, setWord] = useState(null);
  const [wordResult, setWordResult] = useState(null);
  const deferredText = useDeferredValue(pasted);

  const pastedResult = useMemo(
    () => (dictionary && deferredText.trim() ? restoreText(deferredText, dictionary) : null),
    [dictionary, deferredText]
  );

  useEffect(() => {
    if (!word || !dictionary) { setWordResult(null); return undefined; }
    let cancelled = false;
    restoreDocx(word.buffer, dictionary)
      .then((result) => { if (!cancelled) setWordResult(result); })
      .catch(() => { if (!cancelled) { setWordResult(null); notify('No se pudo procesar el Word.', true); } });
    return () => { cancelled = true; };
  }, [word, dictionary, notify]);

  const loadDictionary = useCallback((dict, name) => { setDictionary(dict); setDictionaryName(name); }, []);

  const readDictionaryFile = useCallback(async (file) => {
    if (!file) return;
    // El diccionario solo (.json o .txt) o el .zip de un expediente en partes, que lo trae dentro.
    try { loadDictionary(await readDictionaryFrom(await file.arrayBuffer()), file.name); }
    catch (error) { notify(`Diccionario no válido: ${error.message}`, true); }
  }, [loadDictionary, notify]);

  const readWordFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { notify('Sube un Word (.docx).', true); return; }
    try {
      setWord({ name: file.name, buffer: await file.arrayBuffer() });
      if (!dictionary) notify('Primero elige el diccionario.', true);
    } catch { notify('No se pudo leer el archivo.', true); }
  }, [dictionary, notify]);

  const copyText = useCallback(async () => {
    if (!pastedResult) return false;
    try { await navigator.clipboard.writeText(pastedResult.text); notify('Texto copiado.'); return true; }
    catch { notify('Selecciónalo y cópialo con Ctrl+C.'); return false; }
  }, [pastedResult, notify]);

  const downloadPastedAsWord = useCallback(async () => {
    if (!pastedResult) return;
    const buffer = await buildDocx(pastedResult.text.split('\n'));
    if (await save('texto-restaurado.docx', new Blob([buffer], { type: DOCX_MIME }))) notify('Word guardado.');
  }, [pastedResult, save, notify]);

  const downloadRestoredWord = useCallback(async () => {
    if (!wordResult) return;
    if (await save(`${word.name.replace(/\.docx$/i, '')}-restaurado.docx`, wordResult.blob)) notify('Word restaurado guardado.');
  }, [wordResult, word, save, notify]);

  return {
    dictionary, dictionaryName, mode, pasted, word, wordResult, pastedResult,
    setMode, setPasted, loadDictionary, readDictionaryFile, readWordFile, copyText, downloadPastedAsWord, downloadRestoredWord
  };
}
