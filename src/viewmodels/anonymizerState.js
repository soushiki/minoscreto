import {
  addAlias, addValue, removeAlias, retype, setCategoryEnabled, setEnabled
} from '../model/index.js';

export const initialState = {
  loaded: false,
  buffer: null,
  name: '',
  doc: null,
  isSample: true,
  entities: [],
  excluded: new Set(),
  past: [],
  future: [],
  view: 'split',
  query: '',
  hitIndex: 0,
  openCategories: new Set(['PERSONA', 'EMPRESA']),
  dictionarySaved: false,
  popover: null
};

const snapshot = (s) => ({ entities: s.entities, excluded: s.excluded });

function edit(state, entities, excluded = state.excluded) {
  return { ...state, past: [...state.past.slice(-99), snapshot(state)], future: [], entities, excluded, popover: null };
}

function toggleKey(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

export function anonymizerReducer(state, action) {
  switch (action.type) {
    case 'document-loaded':
      return {
        ...initialState,
        openCategories: state.openCategories,
        view: state.view,
        loaded: true,
        buffer: action.buffer,
        name: action.name,
        doc: action.doc,
        isSample: action.isSample,
        entities: action.entities
      };
    case 'set-entity-enabled':
      return edit(state, setEnabled(state.entities, action.id, action.enabled));
    case 'set-category-enabled':
      return edit(state, setCategoryEnabled(state.entities, action.category, action.enabled));
    case 'toggle-occurrence':
      return edit(state, state.entities, toggleKey(state.excluded, action.key));
    case 'retype':
      return edit(state, retype(state.entities, action.id, action.entityType));
    case 'replace-entities':
      return edit(state, action.entities);
    case 'add-value':
      return edit(state, addValue(state.entities, { text: action.text, type: action.entityType, joinId: action.joinId }));
    case 'add-alias':
      return edit(state, addAlias(state.entities, action.id, action.text));
    case 'remove-alias':
      return edit(state, removeAlias(state.entities, action.id, action.index));
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { ...state, ...previous, past: state.past.slice(0, -1), future: [...state.future, snapshot(state)], popover: null };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[state.future.length - 1];
      return { ...state, ...next, future: state.future.slice(0, -1), past: [...state.past, snapshot(state)], popover: null };
    }
    case 'set-view':
      return { ...state, view: action.view };
    case 'set-query':
      return { ...state, query: action.query, hitIndex: 0 };
    case 'step-hit':
      return { ...state, hitIndex: action.count ? (state.hitIndex + action.delta + action.count) % action.count : 0 };
    case 'set-category-open': {
      if (state.openCategories.has(action.category) === action.open) return state;
      return { ...state, openCategories: toggleKey(state.openCategories, action.category) };
    }
    case 'open-popover':
      return { ...state, popover: action.popover };
    case 'close-popover':
      return state.popover ? { ...state, popover: null } : state;
    case 'dictionary-saved':
      return { ...state, dictionarySaved: true };
    default:
      return state;
  }
}
