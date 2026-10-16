import { addValue, removeAlias, setCategoryEnabled, setEnabled } from '../model/index.js';
import { acceptOcrVariant } from '../model/expediente/index.js';

export const initialExpediente = {
  status: 'idle',
  progress: { done: 0, total: 0 },
  name: '',
  kind: 'pdf',
  docs: null,
  entities: [],
  openCategories: new Set(['PERSONA', 'EMPRESA']),
  applied: null,
  appliedFor: null,
  reduce: true,
  query: '',
  selected: new Set(),
  scope: 'all',
  format: 'zip',
  split: { mode: 'tokens', pagesPerPart: 100, maxTokens: 50000, overlap: 0 },
  ackEmpty: false,
  dismissed: new Set(),
  dictionarySaved: false,
  timings: {}
};

const toggle = (set, key) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

const withEntities = (state, entities) => ({ ...state, entities });

export function expedienteReducer(state, action) {
  switch (action.type) {
    case 'reading':
      return { ...initialExpediente, openCategories: state.openCategories, split: state.split, format: state.format, reduce: state.reduce,
        status: 'reading', name: action.name, kind: action.kind, progress: { done: 0, total: 0 } };
    case 'progress':
      return { ...state, progress: { done: action.done, total: action.total } };
    case 'analyzing':
      return { ...state, status: 'analyzing', timings: { ...state.timings, readMs: action.readMs } };
    case 'loaded':
      return { ...state, status: 'ready', docs: action.docs, entities: action.entities,
        timings: { ...state.timings, layoutMs: action.layoutMs, detectMs: action.detectMs } };
    case 'failed':
      return { ...initialExpediente, openCategories: state.openCategories, split: state.split, format: state.format, reduce: state.reduce };
    case 'applied':
      return { ...state, applied: action.applied, appliedFor: action.key,
        timings: { ...state.timings, applyMs: action.applied.applyMs } };
    case 'exported':
      return { ...state, timings: { ...state.timings, exportMs: action.ms } };
    case 'set':
      return { ...state, [action.key]: action.value };
    case 'set-split':
      return { ...state, split: { ...state.split, ...action.value } };
    case 'set-entity-enabled':
      return withEntities(state, setEnabled(state.entities, action.id, action.enabled));
    case 'set-category-enabled':
      return withEntities(state, setCategoryEnabled(state.entities, action.category, action.enabled));
    case 'remove-alias':
      return withEntities(state, removeAlias(state.entities, action.id, action.index));
    case 'replace-entities':
      return withEntities(state, action.entities);
    case 'add-value':
      return withEntities(state, addValue(state.entities, { text: action.text, type: action.entityType }));
    case 'accept-variants': {
      let entities = state.entities;
      for (const s of action.suggestions) {
        if (!entities.some((e) => e.id === s.entityId) || (s.mergeFrom && !entities.some((e) => e.id === s.mergeFrom))) continue;
        entities = acceptOcrVariant(entities, s);
      }
      return withEntities(state, entities);
    }
    case 'dismiss-variant':
      return { ...state, dismissed: toggle(state.dismissed, action.key) };
    case 'set-category-open':
      if (state.openCategories.has(action.category) === action.open) return state;
      return { ...state, openCategories: toggle(state.openCategories, action.category) };
    case 'toggle-selected':
      return { ...state, selected: toggle(state.selected, action.key) };
    case 'select-many': {
      const selected = new Set(state.selected);
      for (const k of action.keys) if (action.on) selected.add(k); else selected.delete(k);
      return { ...state, selected, scope: action.on && selected.size ? 'selection' : state.scope };
    }
    case 'clear-selection':
      return { ...state, selected: new Set(), scope: 'all' };
    case 'dictionary-saved':
      return { ...state, dictionarySaved: true };
    default:
      return state;
  }
}
