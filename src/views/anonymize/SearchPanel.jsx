import { useEffect, useMemo, useState } from 'react';
import { TYPES, guessType } from '../../model/index.js';

export default function SearchPanel({ vm }) {
  const [text, setText] = useState('');
  const [chosenType, setChosenType] = useState(null);
  const { setQuery } = vm.actions;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 140);
    return () => clearTimeout(timer);
  }, [text, setQuery]);

  useEffect(() => { if (vm.query === '' && text !== '') setText(''); }, [vm.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = vm.query.trim();
  const guessed = useMemo(() => guessType(query), [query]);
  useEffect(() => setChosenType(null), [query]);
  const type = chosenType ?? guessed;
  const total = vm.hits.list.length;

  let message = '';
  if (text.trim().length === 1) message = 'Escribe al menos 2 letras.';
  else if (query.length >= 2) {
    message = total ? `${(vm.hitIndex % total) + 1} de ${total} ${total === 1 ? 'coincidencia' : 'coincidencias'} · Enter para avanzar` : 'Sin coincidencias.';
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); vm.stepHit(e.shiftKey ? -1 : 1); }
  };

  return (
    <section className="card card-search">
      <label className="lbl" htmlFor="q">Buscar en el documento</label>
      <div className="qrow">
        <input id="q" type="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Un nombre, empresa o número" autoComplete="off" spellCheck={false} />
        <button type="button" className="btn" onClick={() => vm.stepHit(-1)} aria-label="Coincidencia anterior">↑</button>
        <button type="button" className="btn" onClick={() => vm.stepHit(1)} aria-label="Coincidencia siguiente">↓</button>
      </div>
      <div className="qmeta">{message}</div>
      {total > 0 && (
        <div className="qadd">
          <select value={type} onChange={(e) => setChosenType(e.target.value)} aria-label="Tipo de dato">
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.single}</option>)}
          </select>
          <button type="button" className="btn primary" onClick={() => vm.addQueryAsValue(type)}>
            Anonimizar {total === 1 ? 'esta' : `las ${total}`}
          </button>
        </div>
      )}
    </section>
  );
}
