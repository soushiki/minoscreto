import { useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  analyze, buildDictionary, buildDocx, dictionaryToText, DocxError, exportAnonymized, findHits,
  buildEntities, findSuggestions, openDocx, partLabel, renameLabel, SAMPLE_NAME, SAMPLE_PARAGRAPHS, countMatches
} from '../model/index.js';
import { anonymizerReducer, initialState } from './anonymizerState.js';

const EMPTY_HITS = { list: [], byParagraph: new Map() };
const categoriesFlat = (categories) => Object.values(categories).flat();

export function useAnonymizer({ save, notify }) {
  const [state, dispatch] = useReducer(anonymizerReducer, initialState);
  const { doc, entities, excluded, query, hitIndex } = state;

  const analysis = useMemo(() => (doc ? analyze(doc.paragraphs, entities, excluded) : null), [doc, entities, excluded]);
  const suggestions = useMemo(() => (doc ? findSuggestions(doc.paragraphs, entities, analysis) : []), [doc, entities, analysis]);
  const hits = useMemo(() => (doc ? findHits(doc.paragraphs, query) : EMPTY_HITS), [doc, query]);
  const currentHit = hits.list.length ? hits.list[hitIndex % hits.list.length] : null;

  const rows = useMemo(() => {
    if (!doc) return [];
    const byId = new Map(entities.map((e) => [e.id, e]));
    return doc.paragraphs.flatMap((p, index) => {
      if (!p.text.trim()) return [];
      const occurrences = analysis.occurrences[index].map((o) => {
        const entity = byId.get(o.id);
        return { ...o, entityId: entity.id, entityType: entity.type, label: entity.label, active: o.replaced };
      });
      const hitRanges = hits.byParagraph.get(index) || [];
      const currentStart = currentHit && currentHit.pi === index ? currentHit.start : -1;
      const signature = JSON.stringify([occurrences.map((o) => [o.start, o.end, o.entityType, o.label, o.active]), hitRanges, currentStart]);
      return [{ index, text: p.text, part: partLabel(p.part), occurrences, hitRanges, currentStart, signature }];
    });
  }, [doc, entities, analysis, hits, currentHit]);

  const categories = useMemo(() => {
    const counts = analysis ? analysis.counts : {};
    return entities.reduce((acc, e) => {
      (acc[e.type] ||= []).push({ ...e, count: counts[e.id] || 0 });
      return acc;
    }, {});
  }, [entities, analysis]);

  const entityIndex = useMemo(() => new Map(categoriesFlat(categories).map((e) => [e.id, e])), [categories]);

  const dictionary = useMemo(() => (analysis ? buildDictionary(entities, analysis.usedIds) : {}), [entities, analysis]);
  const replacements = analysis ? analysis.replacements : 0;

  const loadBuffer = useCallback(async (buffer, name, isSample) => {
    const opened = await openDocx(buffer);
    if (!opened.paragraphs.some((p) => p.text.trim())) {
      notify('Este Word no tiene texto para revisar.', true);
      return false;
    }
    dispatch({ type: 'document-loaded', buffer, name, doc: opened, isSample, entities: buildEntities(opened.paragraphs) });
    return true;
  }, [notify]);

  useEffect(() => {
    let cancelled = false;
    buildDocx(SAMPLE_PARAGRAPHS).then((buffer) => { if (!cancelled) loadBuffer(buffer, SAMPLE_NAME, true); });
    return () => { cancelled = true; };
  }, [loadBuffer]);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      notify('Aquí se abre Word (.docx); para PDF usa la pestaña Expediente PDF. Si tu archivo es .doc, ábrelo en Word y guárdalo como .docx.', true);
      return;
    }
    try {
      const ok = await loadBuffer(await file.arrayBuffer(), file.name.replace(/\.docx$/i, ''), false);
      if (ok) { window.scrollTo(0, 0); notify('Documento abierto. Revisa los datos detectados.'); }
    } catch (error) {
      notify(error instanceof DocxError ? 'Este archivo no parece un Word válido. ¿Está protegido con contraseña?' : 'No se pudo leer el archivo.', true);
    }
  }, [loadBuffer, notify]);

  const downloadDocx = useCallback(async () => {
    try {
      const { blob } = await exportAnonymized(state.buffer, entities, excluded);
      const saved = await save(`${state.name}-anonimizado.docx`, blob);
      if (saved) notify(state.dictionarySaved ? 'Word anonimizado guardado.' : 'Word guardado. Descarga también el diccionario: sin él no podrás restaurar los nombres.');
    } catch (error) {
      notify(`No se pudo generar el Word: ${error.message}`, true);
    }
  }, [state.buffer, state.name, state.dictionarySaved, entities, excluded, save, notify]);

  const downloadDictionary = useCallback(async (asText) => {
    if (!Object.keys(dictionary).length) { notify('Todavía no hay nada anonimizado.', true); return; }
    const saved = asText
      ? await save(`${state.name}-diccionario.txt`, dictionaryToText(dictionary))
      : await save(`${state.name}-diccionario.json`, JSON.stringify(dictionary, null, 2));
    if (saved) { dispatch({ type: 'dictionary-saved' }); notify('Diccionario guardado. Guárdalo aparte del Word anonimizado.'); }
  }, [dictionary, state.name, save, notify]);

  const actions = useMemo(() => ({
    setEntityEnabled: (id, enabled) => dispatch({ type: 'set-entity-enabled', id, enabled }),
    setCategoryEnabled: (category, enabled) => dispatch({ type: 'set-category-enabled', category, enabled }),
    toggleOccurrence: (key) => dispatch({ type: 'toggle-occurrence', key }),
    retype: (id, entityType) => dispatch({ type: 'retype', id, entityType }),
    removeAlias: (id, index) => dispatch({ type: 'remove-alias', id, index }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    setView: (view) => dispatch({ type: 'set-view', view }),
    setQuery: (query) => dispatch({ type: 'set-query', query }),
    setCategoryOpen: (category, open) => dispatch({ type: 'set-category-open', category, open }),
    openPopover: (popover) => dispatch({ type: 'open-popover', popover }),
    closePopover: () => dispatch({ type: 'close-popover' })
  }), []);

  const renameEntity = useCallback((id, raw) => {
    const result = renameLabel(entities, id, raw);
    if (result.error) { notify(result.error, true); return; }
    if (result.entities !== entities) dispatch({ type: 'replace-entities', entities: result.entities });
  }, [entities, notify]);

  const addText = useCallback((text, entityType, joinId = '') => {
    dispatch({ type: 'add-value', text, entityType, joinId });
    const count = countMatches(doc.paragraphs, text);
    notify(`«${text}» se anonimiza en ${count} ${count === 1 ? 'lugar' : 'lugares'}.`);
  }, [doc, notify]);

  const addAliasTo = useCallback((entityId, text) => {
    dispatch({ type: 'add-alias', id: entityId, text });
    const host = entities.find((e) => e.id === entityId);
    notify(`«${text}» ahora se reemplaza por [${host.label}].`);
  }, [entities, notify]);

  const addQueryAsValue = useCallback((entityType) => {
    const text = query.trim();
    if (text.length < 2) return;
    dispatch({ type: 'set-query', query: '' });
    addText(text, entityType);
  }, [query, addText]);

  const stepHit = useCallback((delta) => dispatch({ type: 'step-hit', delta, count: hits.list.length }), [hits.list.length]);

  return {
    state, loaded: state.loaded, name: state.name, isSample: state.isSample, view: state.view,
    warnings: doc ? doc.warnings : null, rows, categories, entities, suggestions, hits, currentHit, hitIndex,
    query, replacements, dictionary, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    openCategories: state.openCategories, popover: state.popover, entityIndex,
    paragraphCount: doc ? doc.paragraphs.filter((p) => p.text.trim()).length : 0,
    enabledCount: entities.filter((e) => e.enabled).length,
    actions, loadFile, downloadDocx, downloadDictionary, renameEntity, addText, addAliasTo, addQueryAsValue, stepHit
  };
}
