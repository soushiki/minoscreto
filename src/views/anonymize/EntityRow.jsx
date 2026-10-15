import { useEffect, useRef, useState } from 'react';

export default function EntityRow({ entity, vm, onJump }) {
  const [editing, setEditing] = useState(false);
  const input = useRef(null);
  const done = useRef(false);

  useEffect(() => {
    if (editing) { done.current = false; input.current.focus(); input.current.select(); }
  }, [editing]);

  const commit = (value) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    vm.renameEntity(entity.id, value);
  };

  return (
    <div className={`erow t-${entity.type}${entity.enabled ? '' : ' dim'}`}>
      <input type="checkbox" className="echk" checked={entity.enabled}
        onChange={() => vm.actions.setEntityEnabled(entity.id, !entity.enabled)}
        aria-label={`Anonimizar ${entity.value}`} />
      <div>
        <button type="button" className="ejump" onClick={() => onJump(entity.id)} title="Ir a la primera aparición">
          <span className="ev">{entity.value}</span>
        </button>
        {entity.aliases.length > 0 && (
          <span className="al">
            También:{' '}
            {entity.aliases.map((alias, i) => (
              <span key={alias}>
                {i > 0 && ', '}{alias}{' '}
                <button type="button" className="xbtn" onClick={() => vm.actions.removeAlias(entity.id, i)}
                  title="Quitar variante" aria-label={`Quitar variante ${alias}`}>×</button>
              </span>
            ))}
          </span>
        )}
      </div>
      {editing ? (
        <input ref={input} className="elin" defaultValue={entity.label} maxLength={40} aria-label="Etiqueta"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
            if (e.key === 'Escape') { done.current = true; setEditing(false); }
          }}
          onBlur={(e) => commit(e.currentTarget.value)} />
      ) : (
        <button type="button" className="elabel tinted" onClick={() => setEditing(true)} title="Cambiar etiqueta">{entity.label}</button>
      )}
      <span className="ecnt">{entity.count}×</span>
    </div>
  );
}
