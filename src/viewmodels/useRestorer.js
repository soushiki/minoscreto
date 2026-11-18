import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildDocx, DOCX_MIME, readDictionaryFrom, restoreDocx, restoreText } from '../model/index.js';
import { readPdfPages } from '../model/expediente/pdfjs.js';
import { rejoinTags } from '../model/pdf/rejoin.js';
import { usePasswordPrompt } from './usePasswordPrompt.js';

const isPdf = (name) => /\.pdf$/i.test(name);
const lineText = (line) => (typeof line === 'string' ? line : line.text);
// El pie «Página n de N» que pone nuestro escritor (C4) no es texto del documento: el PDF restaurado lleva el suyo.
const OUR_FOOTER = /^\s*Página \d+ de \d+\s*$/;
const withoutOurFooter = (lines) => (lines.length && OUR_FOOTER.test(lines[lines.length - 1]) ? lines.slice(0, -1) : lines);

// PDF → texto (C1) → etiquetas partidas vueltas a unir (C5) → valores reales → PDF nuevo (C4, solo bajo demanda).
async function restorePdf(buffer, dictionary, { askPassword, fileName, signal }) {
  const pages = await readPdfPages(new Uint8Array(buffer), { askPassword, fileName, signal });
  const joined = rejoinTags(pages.map((p) => withoutOurFooter(p.lines.map(lineText)).join('\n')).join('\n'), dictionary);
  const restored = restoreText(joined.text, dictionary);
  const { writeTextPdf } = await import('../model/pdf/writer.js'); // ADR-001: pdf-lib solo se carga al escribir
  const { bytes, dropped } = await writeTextPdf({ lines: restored.text.split('\n') });
  return {
    kind: 'pdf',
    blob: new Blob([bytes], { type: 'application/pdf' }),
    counts: restored.counts,
    // Los fragmentos de etiqueta que no se pudieron unir se listan junto a las etiquetas sin entrada.
    unknown: [...restored.unknown, ...joined.broken.filter((b) => !restored.unknown.includes(b))],
    broken: joined.broken,
    dropped
  };
}

export function useRestorer({ save, notify }) {
  const [dictionary, setDictionary] = useState(null);
  const [dictionaryName, setDictionaryName] = useState('');
  const [mode, setMode] = useState('paste');
  const [pasted, setPasted] = useState('');
  const [word, setWord] = useState(null);
  const [wordResult, setWordResult] = useState(null);
  const deferredText = useDeferredValue(pasted);
  const abortRef = useRef(null);
  const passwordPrompt = usePasswordPrompt({ onCancel: () => abortRef.current?.abort() });
  const { askPassword, close: closePrompt } = passwordPrompt;

  const pastedResult = useMemo(
    () => (dictionary && deferredText.trim() ? restoreText(deferredText, dictionary) : null),
    [dictionary, deferredText]
  );

  useEffect(() => {
    if (!word || !dictionary) { setWordResult(null); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    const run = word.kind === 'pdf'
      ? restorePdf(word.buffer, dictionary, { askPassword, fileName: word.name, signal: controller.signal })
      : restoreDocx(word.buffer, dictionary);
    run
      .then((result) => {
        if (cancelled) return;
        setWordResult(result);
        if (result.dropped?.length) notify('Algunos caracteres no se pueden escribir en el PDF y se omitieron. Revisa el archivo.', true);
      })
      .catch((error) => {
        if (cancelled) return;
        setWordResult(null);
        if (error?.code === 'aborted' || error?.code === 'cancelled') return; // el usuario canceló: sin aviso
        notify(word.kind === 'pdf' ? (error?.message || 'No se pudo procesar el PDF.') : 'No se pudo procesar el Word.', true);
      })
      .finally(() => { if (word.kind === 'pdf' && !cancelled) closePrompt(); }); // si ya no es la lectura vigente, otra pregunta puede estar abierta
    return () => { cancelled = true; controller.abort(); };
  }, [word, dictionary, notify, askPassword, closePrompt]);

  const loadDictionary = useCallback((dict, name) => { setDictionary(dict); setDictionaryName(name); }, []);

  const readDictionaryFile = useCallback(async (file) => {
    if (!file) return;
    // El diccionario solo (.json o .txt) o el .zip de un expediente en partes, que lo trae dentro.
    try { loadDictionary(await readDictionaryFrom(await file.arrayBuffer()), file.name); }
    catch (error) { notify(`Diccionario no válido: ${error.message}`, true); }
  }, [loadDictionary, notify]);

  const readWordFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name) && !isPdf(file.name)) { notify('Sube un Word (.docx) o un PDF.', true); return; }
    try {
      setWord({ name: file.name, kind: isPdf(file.name) ? 'pdf' : 'docx', buffer: await file.arrayBuffer() });
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
    const pdf = word.kind === 'pdf';
    const name = `${word.name.replace(/\.(docx|pdf)$/i, '')}-restaurado.${pdf ? 'pdf' : 'docx'}`;
    if (await save(name, wordResult.blob)) notify(pdf ? 'PDF restaurado guardado.' : 'Word restaurado guardado.');
  }, [wordResult, word, save, notify]);

  return {
    dictionary, dictionaryName, mode, pasted, word, wordResult, pastedResult,
    passwordPrompt, setMode, setPasted, loadDictionary, readDictionaryFile, readWordFile, copyText, downloadPastedAsWord, downloadRestoredWord
  };
}
