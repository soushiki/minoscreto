import { useEffect, useRef } from 'react';
import { TYPES } from '../../model/index.js';
import { flashElement } from '../../utils/dom.js';
import EntityRow from './EntityRow.jsx';

function Category({ type, entities, open, vm, onJump }) {
  const checkbox = useRef(null);
  const enabled = entities.filter((e) => e.enabled).length;
  const all = enabled === entities.length;
  const some = enabled > 0 && !all;

  useEffect(() => { checkbox.current.indeterminate = some; }, [some]);

  return (
    <details className={`cat t-${type.id}`} open={open} onToggle={(e) => vm.actions.setCategoryOpen(type.id, e.currentTarget.open)}>
      <summary>
        <input ref={checkbox} type="checkbox" className="catchk" checked={all}
          aria-label={`Activar o desactivar ${type.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={() => vm.actions.setCategoryEnabled(type.id, !all)} />
        <span className="cdot" />
        <span className="cname">{type.name}</span>
        <span className="cn">{enabled}/{entities.length}</span>
      </summary>
      <div className="elist">
        {entities.map((e) => <EntityRow key={e.id} entity={e} vm={vm} onJump={onJump} />)}
      </div>
    </details>
  );
}

export default function CategoryList({ vm }) {
  const jumps = useRef({});

  const jump = (id) => {
    const nodes = Array.from(document.querySelectorAll(`.cell.orig [data-e="${id}"]`));
    if (!nodes.length) return;
    jumps.current[id] = ((jumps.current[id] ?? -1) + 1) % nodes.length;
    flashElement(nodes[jumps.current[id]]);
  };

  const present = TYPES.filter((t) => vm.categories[t.id]);

  return (
    <section className="card card-cats">
      <h2 className="h">Qué se anonimiza</h2>
      {present.length === 0 && <p className="muted">No se detectó ningún dato. Busca una palabra arriba o haz clic sobre el texto para agregarla.</p>}
      {present.map((t) => (
        <Category key={t.id} type={t} entities={vm.categories[t.id]} open={vm.openCategories.has(t.id)} vm={vm} onJump={jump} />
      ))}
    </section>
  );
}
