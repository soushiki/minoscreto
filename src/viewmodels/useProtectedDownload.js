import { useCallback, useEffect, useRef, useState } from 'react';
import { isAppleTouch } from './platform.js';

/** Pausa entre el documento y el diccionario: muchos navegadores ignoran dos descargas en el mismo instante. */
export const DICTIONARY_DELAY = 500;

/**
 * Descarga protegida: con un solo clic, el documento y luego su diccionario (o un .zip que ya los trae).
 * `receipt` alimenta la lista de verificación que queda a la vista, con la opción de bajar el diccionario de nuevo.
 * En iPhone/iPad el diccionario no baja solo: queda un botón y se marca solo tras el toque.
 */
export function useProtectedDownload({ save, notify }) {
  const [manual] = useState(isAppleTouch);
  const [receipt, setReceipt] = useState(null);
  const dictionary = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const saveDictionary = useCallback(async () => {
    const d = dictionary.current;
    if (!d) return false;
    const ok = await save(d.name, new Blob([d.text], { type: 'application/json' }));
    if (ok) setReceipt((r) => (r ? { ...r, dictDone: true } : r));
    return ok;
  }, [save]);

  /** doc: { name, blob }; dict: { name, text }. */
  const downloadPair = useCallback(async (doc, dict) => {
    clearTimeout(timer.current);
    dictionary.current = dict;
    setReceipt({ kind: 'pair', docName: doc.name, dictName: dict.name, docDone: false, dictDone: false, manual });
    const ok = await save(doc.name, doc.blob);
    if (!ok) { setReceipt(null); return false; }
    setReceipt((r) => ({ ...r, docDone: true }));
    if (!manual) timer.current = setTimeout(saveDictionary, DICTIONARY_DELAY);
    return true;
  }, [save, saveDictionary, manual]);

  /** Un .zip que ya trae el diccionario (expediente en partes). */
  const downloadBundle = useCallback(async (zip, dict) => {
    clearTimeout(timer.current);
    dictionary.current = dict;
    const ok = await save(zip.name, zip.blob);
    setReceipt(ok ? { kind: 'zip', docName: zip.name, dictName: dict.name, docDone: true, dictDone: true } : null);
    return ok;
  }, [save]);

  const clear = useCallback(() => { clearTimeout(timer.current); dictionary.current = null; setReceipt(null); }, []);

  const copyText = useCallback(async (text, what = 'El texto') => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} quedó copiado. Péguelo en la IA con Ctrl+V (o mantenga presionado y elija Pegar).`);
      return true;
    } catch {
      notify('No se pudo copiar automáticamente. Use «Descargar» y abra el archivo.', true);
      return false;
    }
  }, [notify]);

  return { receipt, downloadPair, downloadBundle, downloadDictionaryAgain: saveDictionary, clear, copyText };
}
