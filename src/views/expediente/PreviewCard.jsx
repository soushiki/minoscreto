import { useState } from 'react';
import { TYPE_BY_ID } from '../../model/index.js';

const LIMIT = 12000;

/** Muestra el inicio de una parte tal como la recibirá la IA, con las etiquetas resaltadas. */
function Tagged({ text }) {
  const pieces = text.split(/(\[[A-ZÑ0-9_]+\]|\[(?:Folio|Página)s? [^\]]*\])/g);
  return pieces.map((p, i) => {
    if (i % 2 === 0) return p;
    if (/^\[(Folio|Página)/.test(p)) return <strong key={i} className="xp-folio">{p}</strong>;
    const type = (/^\[([A-Z]+)_\d+\]$/.exec(p) || [])[1];
    return <span key={i} className={`tag t-${TYPE_BY_ID[type] && type !== 'DATO' ? type : 'OTRO'}`}>{p}</span>;
  });
}

export default function PreviewCard({ vm }) {
  const [part, setPart] = useState(0);
  const { rendered } = vm;
  if (!rendered.length) return null;
  const k = Math.min(part, rendered.length - 1);
  const text = rendered[k].text;
  return (
    <section className="card xp-preview">
      <div className="xp-head">
        <h2>Vista previa</h2>
        {rendered.length > 1 && (
          <label className="xp-psel">
            <span className="lbl">Parte</span>
            <select value={k} onChange={(e) => setPart(Number(e.target.value))}>
              {rendered.map((p, i) => <option key={p.number} value={i}>{p.number} de {rendered.length} · {vm.units.many} {p.first}–{p.last}</option>)}
            </select>
          </label>
        )}
      </div>
      <pre className="xp-pre"><Tagged text={text.slice(0, LIMIT)} />{text.length > LIMIT && '\n\n… (la vista previa muestra solo el comienzo)'}</pre>
    </section>
  );
}
