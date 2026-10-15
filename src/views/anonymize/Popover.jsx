import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TYPES, countMatches, findExisting, guessType } from '../../model/index.js';

function EntityPopover({ popover, vm }) {
  const entity = vm.entityIndex.get(popover.entityId);
  if (!entity) return null;
  const excluded = vm.state.excluded.has(popover.key);
  const { actions } = vm;
  return (
    <>
      <div className="pop-h"><span className={`tag t-${entity.type}`}>[{entity.label}]</span><span>{entity.value}</span></div>
      <div className="pop-sub">{entity.count} {entity.count === 1 ? 'aparición' : 'apariciones'} en el documento</div>
      <button type="button" className={`btn${entity.enabled ? '' : ' primary'}`}
        onClick={() => actions.setEntityEnabled(entity.id, !entity.enabled)}>
        {entity.enabled ? 'Dejar de anonimizar en todo el documento' : 'Anonimizar en todo el documento'}
      </button>
      {entity.enabled && (
        <button type="button" className="btn" onClick={() => actions.toggleOccurrence(popover.key)}>
          {excluded ? 'Volver a anonimizar esta aparición' : 'Dejar solo esta aparición sin cambiar'}
        </button>
      )}
      <label>Tipo
        <select value={entity.type} onChange={(e) => actions.retype(entity.id, e.target.value)}>
          {TYPES.map((t) => <option key={t.id} value={t.id}>{t.single}</option>)}
        </select>
      </label>
    </>
  );
}

function NewValuePopover({ popover, vm }) {
  const { text } = popover;
  const existing = findExisting(vm.entities, text);
  const matches = useMemo(() => countMatches(vm.state.doc.paragraphs, text), [vm.state.doc, text]);
  const [type, setType] = useState(() => guessType(text));
  const [joinId, setJoinId] = useState('');
  const options = vm.entities.filter((e) => e.enabled);
  const clip = (s) => (s.length > 34 ? `${s.slice(0, 34)}…` : s);

  const submit = () => {
    window.getSelection()?.removeAllRanges();
    vm.actions.closePopover();
    vm.addText(text, type, joinId);
  };

  return (
    <>
      <div className="pop-h"><span>«{text}»</span></div>
      <div className="pop-sub">
        {matches} {matches === 1 ? 'aparición' : 'apariciones'} en el documento
        {existing ? ` · ya está en la lista (${existing.label})` : ''}
      </div>
      {!existing && !joinId && (
        <label>Tipo de dato
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.single}</option>)}
          </select>
        </label>
      )}
      {!existing && options.length > 0 && (
        <label>Etiqueta
          <select value={joinId} onChange={(e) => setJoinId(e.target.value)}>
            <option value="">Etiqueta nueva</option>
            {options.map((e) => <option key={e.id} value={e.id}>[{e.label}] {clip(e.value)}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="btn primary" onClick={submit}>
        {existing ? (existing.enabled ? 'Ya se anonimiza' : `Activar ${existing.label}`) : 'Anonimizar en todo el documento'}
      </button>
    </>
  );
}

export default function Popover({ vm }) {
  const { popover } = vm;
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const close = vm.actions.closePopover;

  useLayoutEffect(() => {
    if (!popover || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const left = Math.min(Math.max(8, popover.rect.left), window.innerWidth - w - 8);
    let top = popover.rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, popover.rect.top - h - 8);
    setPosition({ left, top });
  }, [popover]);

  useEffect(() => {
    if (!popover) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close);
    };
  }, [popover, close]);

  if (!popover) return null;
  const key = popover.kind === 'entity' ? `${popover.entityId}:${popover.key}` : `new:${popover.text}`;
  return (
    <div ref={ref} className="pop" role="dialog" aria-label="Anonimizar" style={position}>
      {popover.kind === 'entity'
        ? <EntityPopover key={key} popover={popover} vm={vm} />
        : <NewValuePopover key={key} popover={popover} vm={vm} />}
    </div>
  );
}
