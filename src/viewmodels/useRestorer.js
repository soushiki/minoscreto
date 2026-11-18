import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildDocx, DOCX_MIME, nameFromDictionary, readDictionaryFrom, restoreDocx, restoreText } from '../model/index.js';
import { readPdfPages } from '../model/expediente/pdfjs.js';
import { rejoinTags } from '../model/pdf/rejoin.js';
import { stripAiHeader, stripPageMarkers } from '../model/expediente/render.js';
import { usePasswordPrompt } from './usePasswordPrompt.js';
import { OMITTED_CHARS } from './messages.js';

const isPdf = (name) => /\.pdf$/i.test(name);
const lineText = (line) => (typeof line === 'string' ? line : line.text);
// El pie «Página n de N» que pone nuestro escritor (C4) no es texto del documento: el PDF restaurado lleva el suyo.
const OUR_FOOTER = /^\s*Página \d+ de \d+\s*$/;
const withoutOurFooter = (lines) => (lines.length && OUR_FOOTER.test(lines[lines.length - 1]) ? lines.slice(0, -1) : lines);

// PDF → texto (C1). Solo depende del archivo: se lee (y se pide la contraseña) una vez, no al cambiar de diccionario.
async function readPdfText(buffer, { askPassword, fileName, signal }) {
  const pages = await readPdfPages(new Uint8Array(buffer), { askPassword, fileName, signal });
  return pages.map((p) => withoutOurFooter(p.lines.map(lineText)).join('\n')).join('\n');
}

// Texto del PDF → etiquetas partidas vueltas a unir (C5) → valores reales. Rápido: se repite con cada diccionario.
function restorePdfText(text, dictionary) {
  const joined = rejoinTags(text, dictionary);
  const restored = restoreText(joined.text, dictionary);
  return {
    kind: 'pdf',
    // El encabezado para la IA («(anonimizado)», notas de etiquetas) y las marcas [Folio N] no son parte del documento.
    text: stripPageMarkers(stripAiHeader(restored.text)),
    counts: restored.counts,
    // Los fragmentos de etiqueta que no se pudieron unir se listan junto a las etiquetas sin entrada.
    unknown: [...restored.unknown, ...joined.broken.filter((b) => !restored.unknown.includes(b))],
    broken: joined.broken
  };
}

export function useRestorer({ save, notify }) {
  const [dictionary, setDictionary] = useState(null);
  const [dictionaryName, setDictionaryName] = useState('');
  const [mode, setMode] = useState('paste');
  const [pasted, setPasted] = useState('');
  const [word, setWord] = useState(null);
  // Cada resultado guarda de qué archivo (y diccionario) salió: uno viejo nunca se muestra ni descarga con el nombre del nuevo.
  const [docxRestored, setDocxRestored] = useState(null);
  const [pdfText, setPdfText] = useState(null);
  const hasDictionary = Boolean(dictionary);
  const deferredText = useDeferredValue(pasted);
  const abortRef = useRef(null);
  const passwordPrompt = usePasswordPrompt({ onCancel: () => abortRef.current?.abort() });
  const { askPassword, close: closePrompt } = passwordPrompt;

  const pastedResult = useMemo(
    () => (dictionary && deferredText.trim() ? restoreText(deferredText, dictionary) : null),
    [dictionary, deferredText]
  );

  // PDF: se lee al tener archivo y diccionario; cambiar de diccionario no lo vuelve a leer ni a pedir la contraseña (FIX-4).
  useEffect(() => {
    if (!word || word.kind !== 'pdf' || !hasDictionary) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    readPdfText(word.buffer, { askPassword, fileName: word.name, signal: controller.signal })
      .then((text) => { if (!cancelled) setPdfText({ word, text }); })
      .catch((error) => {
        if (cancelled) return;
        if (error?.code === 'aborted' || error?.code === 'cancelled') return; // el usuario canceló: sin aviso
        notify(error?.message || 'No se pudo procesar el PDF.', true);
      })
      .finally(() => { if (!cancelled) closePrompt(); }); // si ya no es la lectura vigente, otra pregunta puede estar abierta
    return () => { cancelled = true; controller.abort(); };
  }, [word, hasDictionary, notify, askPassword, closePrompt]);

  useEffect(() => {
    if (!word || word.kind !== 'docx' || !dictionary) return undefined;
    let cancelled = false;
    restoreDocx(word.buffer, dictionary)
      .then((result) => { if (!cancelled) setDocxRestored({ word, dictionary, result }); })
      .catch(() => { if (!cancelled) notify('No se pudo procesar el Word.', true); });
    return () => { cancelled = true; };
  }, [word, dictionary, notify]);

  const wordResult = useMemo(() => {
    if (!word || !dictionary) return null;
    if (word.kind === 'pdf') return pdfText?.word === word ? restorePdfText(pdfText.text, dictionary) : null;
    return docxRestored?.word === word && docxRestored.dictionary === dictionary ? docxRestored.result : null;
  }, [word, dictionary, pdfText, docxRestored]);

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
    // FIX-10: el archivo de la IA tiene nombre neutro; el nombre real sale del diccionario (si es uno nuestro).
    const stem = nameFromDictionary(dictionaryName) ?? word.name.replace(/\.(docx|pdf)$/i, '');
    const name = `${stem}-restaurado.${pdf ? 'pdf' : 'docx'}`;
    let blob = wordResult.blob;
    let omitted = false;
    if (pdf) {
      // FIX-5: el PDF se escribe solo al descargarlo, no con cada cambio de diccionario.
      try {
        const { writeTextPdf } = await import('../model/pdf/writer.js'); // ADR-001: pdf-lib solo se carga al escribir
        const { bytes, dropped } = await writeTextPdf({ lines: wordResult.text.split('\n') });
        omitted = dropped.length > 0;
        blob = new Blob([bytes], { type: 'application/pdf' });
      } catch (error) {
        notify(`No se pudo escribir el PDF: ${error.message}`, true);
        return;
      }
    }
    if (!(await save(name, blob))) return;
    // Un solo aviso a la vez: el de caracteres omitidos pesa más que «guardado».
    if (omitted) notify(OMITTED_CHARS, true);
    else notify(pdf ? 'PDF restaurado guardado.' : 'Word restaurado guardado.');
  }, [wordResult, word, dictionaryName, save, notify]);

  return {
    dictionary, dictionaryName, mode, pasted, word, wordResult, pastedResult,
    passwordPrompt, setMode, setPasted, loadDictionary, readDictionaryFile, readWordFile, copyText, downloadPastedAsWord, downloadRestoredWord
  };
}
