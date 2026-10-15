import DropZone from '../../components/DropZone.jsx';

export default function DictionaryCard({ vm, current }) {
  const keys = vm.dictionary ? Object.keys(vm.dictionary) : [];
  const currentCount = Object.keys(current.dictionary).length;
  return (
    <section className="card">
      <h2>1. Diccionario</h2>
      <p className="sub">El archivo que descargaste al anonimizar. Tiene una línea por dato, con la forma LLAVE: VALOR.</p>
      <DropZone text="Arrastra el diccionario aquí o" buttonLabel="Elegir archivo (.json o .txt)"
        accept=".json,.txt,application/json,text/plain" onFile={vm.readDictionaryFile} />
      {currentCount > 0 && (
        <div className="row-btns">
          <button type="button" className="btn" onClick={() => vm.loadDictionary(current.dictionary, `${current.name} (documento abierto)`)}>
            Usar el diccionario del documento abierto ({currentCount} etiquetas)
          </button>
        </div>
      )}
      {vm.dictionary && (
        <>
          <p className="mt"><span className="stat">{keys.length} etiquetas</span>{vm.dictionaryName && <span className="muted"> · {vm.dictionaryName}</span>}</p>
          <div className="chips">
            {keys.slice(0, 10).map((k) => <span className="chip" key={k}>{k}</span>)}
            {keys.length > 10 && <span className="chip">+{keys.length - 10} más</span>}
          </div>
        </>
      )}
    </section>
  );
}
