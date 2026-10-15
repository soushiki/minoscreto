export default function SuggestionsPanel({ vm }) {
  if (!vm.suggestions.length) return null;
  return (
    <section className="card card-sugg">
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
    </section>
  );
}
