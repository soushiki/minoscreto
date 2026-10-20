export default function SuggestionsPanel({ vm }) {
  const names = vm.nameSuggestions || [];
  if (!vm.suggestions.length && !names.length) return null;
  return (
    <section className="card card-sugg">
      {vm.suggestions.length > 0 && (
        <>
          <h2 className="h">Posibles fugas</h2>
          <p className="muted">Estas palabras forman parte de un nombre ya anonimizado, pero aparecen sueltas en otros lugares.</p>
          {vm.suggestions.map((s) => {
            const host = vm.entityIndex.get(s.entityId);
            return (
              <div className="sg-row" key={s.token}>
                <span><strong>{s.token}</strong> · {s.count} {s.count > 1 ? 'veces' : 'vez'} sin anonimizar</span>
                <button type="button" className="btn sm" onClick={() => vm.addAliasTo(s.entityId, s.token)} title={`Agregar a ${host.label}`}>
                  Unir a {host.label}
                </button>
              </div>
            );
          })}
        </>
      )}
      {names.length > 0 && (
        <>
          <h2 className={`h${vm.suggestions.length ? ' sg-next' : ''}`}>¿Es un nombre?</h2>
          <p className="muted">Podrían ser el nombre de una persona, un proyecto, un lugar o una marca. Revíselas.</p>
          {names.map((n) => (
            <div className={`sg-row t-${n.type}`} key={n.id}>
              <span><strong>{n.value}</strong> · {n.count} {n.count === 1 ? 'vez' : 'veces'}</span>
              <button type="button" className="btn sm" onClick={() => vm.actions.setEntityEnabled(n.id, true)} title={`Reemplazar por [${n.label}]`}>Anonimizar</button>
              <button type="button" className="xbtn" onClick={() => vm.dismissName(n.id)} title="No es un nombre" aria-label={`${n.value} no es un nombre`}>×</button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
