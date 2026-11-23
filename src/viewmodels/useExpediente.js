import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  buildDictionary, bundleFileName, dictionaryFileName, dictionaryJson, DocxError, exportCode, protectedFileName, renameLabel
} from '../model/index.js';
import { LAYOUT_FALLBACK, LAYOUT_PREPARING, layoutProgress, OMITTED_CHARS } from './messages.js';
import {
  buildPartsZip, buildSearchIndex, estimateTokens, formatPageRanges, renderParts, renderWhole, searchIndex, splitParts, unitOf
} from '../model/expediente/index.js';
import { expedienteReducer, initialExpediente } from './expedienteState.js';
import { runExpedienteTask } from './expedienteWorker.js';
import { useProtectedDownload } from './useProtectedDownload.js';
import { usePasswordPrompt } from './usePasswordPrompt.js';

const keyOf = (p) => `${p.page}:${p.text}`;
const variantKey = (s) => `${s.entityId}:${s.variant}`;
const now = () => performance.now();

export function useExpediente({ save, notify }) {
  const [state, dispatch] = useReducer(expedienteReducer, initialExpediente);
  const { docs, entities, reduce, applied, appliedFor, selected, scope, format, split, query } = state;
  const abort = useRef(null);
  // PDF cargado (copia de sus bytes y si pidió contraseña) para el PDF con diseño; se borra con otro archivo.
  const source = useRef(null);
  const layoutAbort = useRef(null);
  const layoutCancelled = useRef(false);
  const busy = useRef(false);
  // A quién responde «Cancelar» del diálogo: a la lectura ('read') o al PDF con diseño ('layout', ADR-007).
  const passwordMode = useRef('read');
  // Cancelar en la lectura la corta, igual que «Cancelar» de la pantalla de progreso (sin aviso). En el PDF con
  // diseño corta solo ese intento: sale el PDF de texto con su aviso.
  const password = usePasswordPrompt({
    onCancel: () => {
      if (passwordMode.current === 'layout') { layoutCancelled.current = true; layoutAbort.current?.abort(); return; }
      abort.current?.abort(); source.current = null; dispatch({ type: 'failed' });
    }
  });
  const { askPassword, close: closePassword } = password;
  const protectedDownload = useProtectedDownload({ save, notify });
  const { clear: clearReceipt, prepare, downloadPair, downloadBundle, copyText } = protectedDownload;
  useEffect(() => () => { layoutAbort.current?.abort(); }, []);
  useEffect(() => { clearReceipt(); }, [docs, clearReceipt]);

  const doc = docs ? (reduce ? docs.reduced : docs.full) : null;
  const variant = reduce ? 'reduced' : 'full';
  const texts = useMemo(() => (doc ? doc.paragraphs.map((p) => p.text) : []), [doc]);

  // Anonimizar (en el worker) cada vez que cambian los datos o la versión del texto.
  useEffect(() => {
    if (!doc) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      runExpedienteTask('apply', { texts, entities })
        .then((result) => { if (current) dispatch({ type: 'applied', applied: result, key: { variant, entities } }); })
        .catch((error) => { if (current) notify(`No se pudo anonimizar: ${error.message}`, true); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [doc, texts, entities, variant, notify]);

  const fresh = applied && appliedFor && appliedFor.variant === variant && appliedFor.entities === entities;
  const ready = Boolean(applied && appliedFor && appliedFor.variant === variant);

  const keys = useMemo(() => (doc ? doc.paragraphs.map(keyOf) : []), [doc]);

  const blocks = useMemo(() => {
    if (!doc || !ready) return [];
    const all = doc.paragraphs.map((p, index) => ({ index, page: p.page, heading: p.heading, text: applied.texts[index] }));
    return scope === 'selection' ? all.filter((_, i) => selected.has(keys[i])) : all;
  }, [doc, ready, applied, scope, selected, keys]);

  const parts = useMemo(() => (format === 'zip' && blocks.length ? splitParts(blocks, split) : []), [format, blocks, split]);
  const isSelection = scope === 'selection';
  const unit = doc ? doc.unit : 'folio';

  const rendered = useMemo(() => {
    if (!blocks.length || !doc) return [];
    if (format === 'md' || parts.length <= 1) {
      return [{ number: 1, first: blocks[0].page, last: blocks[blocks.length - 1].page, text: renderWhole({ blocks, emptyPages: doc.emptyPages, selection: isSelection, unit }) }];
    }
    return renderParts({ blocks, parts, emptyPages: doc.emptyPages, selection: isSelection, unit });
  }, [blocks, parts, format, doc, isSelection, unit]);

  const outputTokens = rendered.reduce((n, p) => n + estimateTokens(p.text.length), 0);

  const counts = useMemo(() => (ready ? applied.counts : {}), [ready, applied]);
  const categories = useMemo(() => entities.reduce((acc, e) => {
    (acc[e.type] ||= []).push({ ...e, count: counts[e.id] || 0 });
    return acc;
  }, {}), [entities, counts]);

  const dictionary = useMemo(() => (ready ? buildDictionary(entities, new Set(applied.usedIds), applied.sources) : {}), [ready, entities, applied]);

  const suggestions = useMemo(() => {
    if (!fresh) return [];
    const byId = new Map(entities.map((e) => [e.id, e]));
    return applied.variants
      .filter((s) => byId.has(s.entityId) && (!s.mergeFrom || byId.has(s.mergeFrom)) && !state.dismissed.has(variantKey(s)))
      .map((s) => ({ ...s, key: variantKey(s), label: byId.get(s.entityId).label, type: byId.get(s.entityId).type }));
  }, [fresh, applied, entities, state.dismissed]);

  // Búsqueda en todos los folios, sobre el texto original.
  const index = useMemo(() => buildSearchIndex(texts), [texts]);
  const deferredQuery = useDeferredValue(query);
  const search = useMemo(() => {
    const r = searchIndex(index, deferredQuery, 400);
    const byParagraph = new Map();
    for (const h of r.hits) {
      if (!byParagraph.has(h.pi)) byParagraph.set(h.pi, []);
      byParagraph.get(h.pi).push([h.start, h.end]);
    }
    const results = [...byParagraph].slice(0, 150).map(([pi, ranges]) => ({
      pi, key: keys[pi], page: doc.paragraphs[pi].page, text: texts[pi], ranges, selected: selected.has(keys[pi])
    }));
    const allKeys = [...r.paragraphs].map((pi) => keys[pi]);
    return { total: r.total, paragraphs: r.paragraphs.size, results, allKeys, allSelected: allKeys.length > 0 && allKeys.every((k) => selected.has(k)) };
  }, [index, deferredQuery, keys, texts, doc, selected]);

  // PDF: se lee la capa de texto folio por folio. Word: párrafos y saltos de página guardados por Word.
  const readSource = useCallback(async (file, signal) => {
    const buffer = await file.arrayBuffer();
    if (/\.docx$/i.test(file.name)) {
      const { readDocxParagraphs } = await import('../model/expediente/docxSource.js');
      const { paragraphs } = await readDocxParagraphs(buffer);
      return { paragraphs };
    }
    const { readPdfPages } = await import('../model/expediente/pdfjs.js');
    // Copia antes de pdf.js (puede quedarse con el buffer): es lo que abre el motor del PDF con diseño.
    const bytes = new Uint8Array(buffer.slice(0));
    let hadPassword = false;
    let lastPaint = 0;
    const pages = await readPdfPages(new Uint8Array(buffer), {
      signal,
      askPassword: (options) => { hadPassword = true; return askPassword(options); },
      fileName: file.name,
      onProgress: (done, total) => {
        if (done === total || now() - lastPaint > 80) { lastPaint = now(); dispatch({ type: 'progress', done, total }); }
      }
    });
    return { pages, original: { bytes, hadPassword } };
  }, [askPassword]);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      notify('El modo expediente recibe PDF o Word (.docx). Si tu archivo es .doc, ábrelo en Word y guárdalo como .docx.', true);
      return;
    }
    abort.current?.abort();
    layoutAbort.current?.abort();
    source.current = null;
    const controller = new AbortController();
    abort.current = controller;
    const isWord = /\.docx$/i.test(file.name);
    dispatch({ type: 'reading', name: file.name.replace(/\.(pdf|docx)$/i, ''), kind: isWord ? 'docx' : 'pdf' });
    try {
      const t = now();
      const { original, ...read } = await readSource(file, controller.signal);
      if (controller.signal.aborted) return;
      dispatch({ type: 'analyzing', readMs: now() - t });
      const result = await runExpedienteTask('prepare', read);
      if (controller.signal.aborted) return;
      if (!result.full.paragraphs.length) {
        dispatch({ type: 'failed' });
        notify(isWord ? 'Este Word no tiene texto para revisar.' : 'Este PDF no tiene texto: hazle OCR en Acrobat y vuelve a cargarlo.', true);
        return;
      }
      // Ids propios de esta pantalla: los del worker podrían repetirse con los que se crean aquí.
      const ids = result.entities.map((e, i) => ({ ...e, id: `x${i + 1}` }));
      source.current = original ?? null;
      dispatch({ type: 'loaded', docs: { full: result.full, reduced: result.reduced }, entities: ids, layoutMs: result.layoutMs, detectMs: result.detectMs });
      const { unit: u, pageCount: n, emptyPages } = result.full;
      const names = unitOf(u);
      const empty = emptyPages.length;
      notify(empty
        ? `Expediente leído (${n} ${names.many}). ${empty} ${empty === 1 ? 'folio no tiene' : 'folios no tienen'} texto: revisa el aviso.`
        : `Expediente leído: ${n} ${n === 1 ? names.one : names.many}. Revisa los datos detectados y exporta.`);
    } catch (error) {
      if (error?.code === 'aborted' || error?.code === 'cancelled') return;
      dispatch({ type: 'failed' });
      if (isWord) notify(error instanceof DocxError ? 'Este archivo no parece un Word válido. ¿Está protegido con contraseña?' : 'No se pudo leer el Word.', true);
      else notify(error?.code ? error.message : `No se pudo leer el PDF: ${error?.message || 'error'}`, true);
    } finally {
      if (abort.current === controller) closePassword();
    }
  }, [notify, readSource, closePassword]);

  const cancel = useCallback(() => { abort.current?.abort(); source.current = null; dispatch({ type: 'failed' }); }, []);

  /**
   * PDF con diseño original (R1–R10): motor primero (si no carga, sin preguntar nada), la contraseña otra vez si el
   * archivo la tenía (ADR-007), luego protectLayout. Responde { bytes, imagePages }, { fallback: aviso } o 'aborted'
   * (otro archivo o pantalla cerrada: no se descarga nada).
   */
  const makeLayout = useCallback(async (original) => {
    prepare(LAYOUT_PREPARING);
    const controller = new AbortController();
    layoutAbort.current = controller;
    layoutCancelled.current = false;
    const stopped = () => (layoutCancelled.current ? { fallback: LAYOUT_FALLBACK['password-cancel'] } : 'aborted');
    // Otro archivo cargado mientras tanto: su diálogo de contraseña no es de este intento.
    const current = () => source.current === original;
    try {
      const { loadEngine } = await import('../model/engine/loader.js');
      try { await loadEngine(); } catch { return controller.signal.aborted ? 'aborted' : { fallback: LAYOUT_FALLBACK.engine }; }
      if (controller.signal.aborted) return 'aborted';
      const { protectLayout } = await import('../model/layout/protect.js');
      let reason = 'layout';
      for (;;) {
        let pass = '';
        if (original.hadPassword) {
          passwordMode.current = 'layout';
          pass = await askPassword({ fileName: `${state.name}.pdf`, reason, signal: controller.signal });
          if (pass === null) return controller.signal.aborted && !layoutCancelled.current ? 'aborted' : { fallback: LAYOUT_FALLBACK['password-cancel'] };
        }
        let lastPaint = 0;
        let opened = false;
        try {
          return await protectLayout({
            bytes: original.bytes.slice(), password: pass, entities, signal: controller.signal,
            onProgress: ({ phase, done, total }) => {
              if (phase === 'scan' && !opened) { opened = true; if (original.hadPassword && current()) closePassword(); }
              if (phase === 'edit' && (done === total || now() - lastPaint > 500)) { lastPaint = now(); prepare(layoutProgress(done, total), { done, total }); }
            }
          });
        } catch (error) {
          if (error?.name === 'AbortError' || controller.signal.aborted) return stopped();
          if (error?.name !== 'LayoutRefused') return { fallback: LAYOUT_FALLBACK.error };
          if (error.where === 'password' && original.hadPassword) { reason = 'incorrect'; continue; }
          return { fallback: error.reason === 'scan' ? LAYOUT_FALLBACK.scan(error.pages) : (LAYOUT_FALLBACK[error.reason] ?? LAYOUT_FALLBACK.error) };
        }
      }
    } finally {
      if (current()) {
        passwordMode.current = 'read';
        if (original.hadPassword) closePassword();
      }
      if (layoutAbort.current === controller) layoutAbort.current = null;
    }
  }, [prepare, askPassword, closePassword, entities, state.name]);

  // Un archivo: el .md protegido y, medio segundo después, el diccionario. En partes: un .zip que trae ambos.
  const download = useCallback(async () => {
    if (!rendered.length || busy.current) return; // un segundo clic mientras se prepara no hace nada
    busy.current = true;
    const t = now();
    const code = exportCode(); // uno por exportación: los archivos para la IA (nombre neutro) ↔ su diccionario
    const dict = { name: dictionaryFileName(state.name, code), text: dictionaryJson(dictionary) };
    try {
      if (rendered.length === 1 && state.kind === 'pdf') {
        // Con diseño el documento entero, aunque «Reducir tamaño» esté marcado (reduce es para el texto de la IA, user 2026-11-22); «Solo marcados» → PDF de texto, sin aviso.
        const original = scope !== 'selection' ? source.current : null;
        let extra = {};
        if (original) {
          const layout = await makeLayout(original);
          if (layout === 'aborted') { if (source.current === original) clearReceipt(); return; }
          if (layout.bytes) {
            // El PDF con diseño cambia cada dato activo del documento entero, también los de encabezados que «Reducir
            // tamaño» quita del texto: su diccionario los trae todos, con las variantes en el orden del texto completo.
            const sources = reduce
              ? (await runExpedienteTask('apply', { texts: docs.full.paragraphs.map((p) => p.text), entities })).sources
              : applied.sources;
            const full = { name: dict.name, text: dictionaryJson(buildDictionary(entities, null, sources)) };
            await downloadPair({ name: protectedFileName(code, 'pdf'), blob: new Blob([layout.bytes], { type: 'application/pdf' }) }, full, { layout: true, imagePages: layout.imagePages });
            dispatch({ type: 'exported', ms: now() - t });
            return;
          }
          extra = { fallback: layout.fallback };
        }
        const { writeTextPdf } = await import('../model/pdf/writer.js');
        const { bytes, dropped } = await writeTextPdf({ lines: rendered[0].text.split('\n') });
        if (dropped.length) notify(OMITTED_CHARS, true);
        await downloadPair({ name: protectedFileName(code, 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }) }, dict, extra);
      } else if (rendered.length === 1) {
        await downloadPair({ name: protectedFileName(code, 'md'), blob: new Blob([rendered[0].text], { type: 'text/markdown;charset=utf-8' }) }, dict);
      } else {
        const blob = await buildPartsZip({
          name: state.name, code, parts: rendered, dictionary, pdf: state.kind === 'pdf',
          onDropped: () => notify(OMITTED_CHARS, true)
        });
        await downloadBundle({ name: bundleFileName(state.name, code), blob }, dict);
      }
      dispatch({ type: 'exported', ms: now() - t });
    } catch (error) {
      clearReceipt();
      notify(`No se pudo exportar: ${error.message}`, true);
    } finally {
      busy.current = false;
    }
  }, [rendered, state.name, state.kind, scope, dictionary, reduce, docs, entities, applied, makeLayout, clearReceipt, downloadPair, downloadBundle, notify]);

  /** Copia el texto de una parte (o del archivo único) para pegarlo en la IA sin descomprimir nada. */
  const copyPart = useCallback((index = 0) => {
    const part = rendered[index];
    if (!part) return;
    copyText(part.text, rendered.length > 1 ? `La parte ${part.number} de ${rendered.length}` : 'El texto protegido');
  }, [rendered, copyText]);

  const renameEntity = useCallback((id, raw) => {
    const result = renameLabel(entities, id, raw);
    if (result.error) { notify(result.error, true); return; }
    if (result.entities !== entities) dispatch({ type: 'replace-entities', entities: result.entities });
  }, [entities, notify]);

  const addQueryAsValue = useCallback(() => {
    const text = query.trim();
    if (text.length < 2) return;
    dispatch({ type: 'add-value', text, entityType: 'OTRO' });
    notify(`«${text}» se anonimiza en ${search.total} ${search.total === 1 ? 'lugar' : 'lugares'}.`);
  }, [query, search.total, notify]);

  const actions = useMemo(() => ({
    setEntityEnabled: (id, enabled) => dispatch({ type: 'set-entity-enabled', id, enabled }),
    setCategoryEnabled: (category, enabled) => dispatch({ type: 'set-category-enabled', category, enabled }),
    removeAlias: (id, i) => dispatch({ type: 'remove-alias', id, index: i }),
    setCategoryOpen: (category, open) => dispatch({ type: 'set-category-open', category, open }),
    setReduce: (value) => dispatch({ type: 'set', key: 'reduce', value }),
    setFormat: (value) => dispatch({ type: 'set', key: 'format', value }),
    setScope: (value) => dispatch({ type: 'set', key: 'scope', value }),
    setSplit: (value) => dispatch({ type: 'set-split', value }),
    setQuery: (value) => dispatch({ type: 'set', key: 'query', value }),
    setAckEmpty: (value) => dispatch({ type: 'set', key: 'ackEmpty', value }),
    toggleSelected: (key) => dispatch({ type: 'toggle-selected', key }),
    selectMany: (list, on) => dispatch({ type: 'select-many', keys: list, on }),
    clearSelection: () => dispatch({ type: 'clear-selection' }),
    acceptVariants: (list) => dispatch({ type: 'accept-variants', suggestions: list }),
    dismissVariant: (key) => dispatch({ type: 'dismiss-variant', key })
  }), []);

  const emptyPages = docs ? docs.full.emptyPages : [];
  const pageCount = docs ? docs.full.pageCount : 0;
  const blocked = emptyPages.length > 0 && !state.ackEmpty;

  return {
    status: state.status, progress: state.progress, name: state.name, kind: state.kind, loaded: state.status === 'ready', pageCount,
    unit, units: unitOf(unit),
    emptyPages, emptyRanges: formatPageRanges(emptyPages), blocked,
    reduce, tokens: docs ? { full: docs.full.tokens, reduced: docs.reduced.tokens } : null,
    removed: docs ? docs.reduced.removed : null, ocrFixes: docs ? docs.full.ocrFixes : 0,
    paragraphCount: doc ? doc.paragraphs.length : 0,
    applying: Boolean(doc) && !fresh, ready, categories, openCategories: state.openCategories, entities,
    replacements: ready ? applied.replacements : 0, dictionary, suggestions,
    query, search, selectedCount: selected.size, scope, format, split, parts, rendered, outputTokens,
    canExport: ready && blocks.length > 0 && !blocked, timings: state.timings, ackEmpty: state.ackEmpty,
    receipt: protectedDownload.receipt, downloadDictionaryAgain: protectedDownload.downloadDictionaryAgain,
    password: { prompt: password.prompt, submit: password.submit, cancel: password.cancel },
    actions, loadFile, cancel, download, copyPart, renameEntity, addQueryAsValue
  };
}
