import { useEffect, useState } from 'react';

function Snippet({ text, ranges }) {
  const [start] = ranges[0];
  const from = Math.max(0, start - 70);
  const to = Math.min(text.length, start + 150);
  const pieces = [];
  let pos = from;
  for (const [s, e] of ranges) {
    if (s < pos || e > to) continue;
    pieces.push(text.slice(pos, s), <mark key={s} className="hit">{text.slice(s, e)}</mark>);
    pos = e;
  }
  pieces.push(text.slice(pos, to));
  return <span className="xp-snip">{from > 0 && '…'}{pieces}{to < text.length && '…'}</span>;
}

export default function ExpSearchCard({ vm }) {
  const [text, setText] = useState(vm.query);
  const { setQuery } = vm.actions;
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 160);
    return () => clearTimeout(timer);
  }, [text, setQuery]);

  const { search } = vm;
  const q = vm.query.trim();
  const { allSelected } = search;

  return (
    <section className="card card-search xp-search">
      <label className="lbl" htmlFor="xq">Buscar en todos los folios</label>
      <div className="qrow">
        <input id="xq" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Una palabra, nombre o número" autoComplete="off" spellCheck={false} />
      </div>
      <div className="qmeta">
        {q.length >= 2 && (search.total
          ? `${search.total} ${search.total === 1 ? 'coincidencia' : 'coincidencias'} en ${search.paragraphs} ${search.paragraphs === 1 ? 'párrafo' : 'párrafos'}`
          : 'Sin coincidencias.')}
        {q.length < 2 && 'Marca pasajes para exportar solo esos.'}
      </div>
      {search.total > 0 && (
        <div className="row-btns xp-sbtns">
          <button type="button" className="btn sm" onClick={() => vm.actions.selectMany(search.allKeys, !allSelected)}>
            {allSelected ? 'Quitar estos párrafos' : `Marcar ${search.paragraphs === 1 ? 'el párrafo' : `los ${search.paragraphs} párrafos`}`}
          </button>
          <button type="button" className="btn sm" onClick={vm.addQueryAsValue} title="Agrega el texto buscado como dato a anonimizar">Anonimizar «{q}»</button>
        </div>
      )}
      {search.results.length > 0 && (
        <ul className="xp-hits">
          {search.results.map((r) => (
            <li key={r.pi} className={r.selected ? 'on' : ''}>
              <label>
                <input type="checkbox" checked={r.selected} onChange={() => vm.actions.toggleSelected(r.key)} aria-label={`Marcar pasaje del folio ${r.page}`} />
                <span className="xp-pg">Folio {r.page}</span>
                <Snippet text={r.text} ranges={r.ranges} />
              </label>
            </li>
          ))}
          {search.paragraphs > search.results.length && <li className="muted">… y {search.paragraphs - search.results.length} párrafos más (usa «Marcar» para incluirlos todos).</li>}
        </ul>
      )}
      {vm.selectedCount > 0 && (
        <p className="xp-selmeta">
          <span className="stat">{vm.selectedCount} {vm.selectedCount === 1 ? 'pasaje marcado' : 'pasajes marcados'}</span>
          <button type="button" className="btn ghost sm" onClick={vm.actions.clearSelection}>Quitar marcas</button>
        </p>
      )}
    </section>
  );
}
