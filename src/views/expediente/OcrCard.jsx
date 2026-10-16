export default function OcrCard({ vm }) {
  const list = vm.suggestions;
  if (!list.length) return null;
  const shown = list.slice(0, 30);
  return (
    <section className="card card-sugg xp-ocr">
      <h2 className="h">Posibles errores de OCR</h2>
      <p className="muted">Nombres casi iguales a uno ya detectado. Únelos para que usen la misma etiqueta y no se escapen.</p>
      {shown.map((s) => (
        <div className={`sg-row t-${s.type}`} key={s.key}>
          <span>«{s.variant}» <span className="muted">({s.count}×)</span> → <span className="tag">{s.label}</span></span>
          <button type="button" className="btn sm" onClick={() => vm.actions.acceptVariants([s])}>Unir</button>
          <button type="button" className="xbtn" onClick={() => vm.actions.dismissVariant(s.key)} aria-label={`Descartar ${s.variant}`} title="No es la misma persona">×</button>
        </div>
      ))}
      <div className="row-btns">
        <button type="button" className="btn primary sm" onClick={() => vm.actions.acceptVariants(list)}>Unir {list.length === 1 ? 'la sugerencia' : `las ${list.length}`}</button>
      </div>
    </section>
  );
}
