const limited = (list, n = 12) => `${list.slice(0, n).join(', ')}${list.length > n ? '…' : ''}`;

function Unknown({ list }) {
  return list.length > 0 ? <div className="note mt"><p><strong>Sin entrada en el diccionario:</strong> {list.join(', ')}</p></div> : null;
}

function Missing({ dictionary, counts, where }) {
  const missing = Object.keys(dictionary).filter((k) => !counts[k]);
  return missing.length > 0 ? <p className="muted mt">No aparecen en {where}: {limited(missing)}</p> : null;
}

const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

function Pasted({ vm }) {
  const r = vm.pastedResult;
  return (
    <>
      <p><span className="stat">{total(r.counts)} etiquetas restauradas</span></p>
      <Unknown list={r.unknown} />
      <div className="restored mt">
        {r.segments.map((s, i) => (s.restored ? <mark key={i}>{s.text}</mark> : s.text))}
      </div>
      <div className="row-btns">
        <button type="button" className="btn primary" onClick={vm.copyText}>Copiar texto</button>
        <button type="button" className="btn" onClick={vm.downloadPastedAsWord}>Descargar como Word</button>
      </div>
      <Missing dictionary={vm.dictionary} counts={r.counts} where="el texto" />
    </>
  );
}

function FromWord({ vm }) {
  const r = vm.wordResult;
  return (
    <>
      <p><span className="stat">{total(r.counts)} etiquetas restauradas</span> <span className="muted">· {vm.word.name}</span></p>
      <Unknown list={r.unknown} />
      <div className="row-btns">
        <button type="button" className="btn primary" onClick={vm.downloadRestoredWord}>Descargar Word restaurado</button>
      </div>
      <Missing dictionary={vm.dictionary} counts={r.counts} where="el documento" />
    </>
  );
}

export default function ResultCard({ vm }) {
  let content;
  if (!vm.dictionary) content = <p className="muted">Primero elige el diccionario.</p>;
  else if (vm.mode === 'paste') {
    content = vm.pastedResult ? <Pasted vm={vm} /> : <p className="muted">Pega la respuesta de la IA para ver el texto con los datos reales.</p>;
  } else {
    content = vm.wordResult ? <FromWord vm={vm} /> : <p className="muted">Sube el Word que generó la IA para reemplazar las etiquetas por los datos reales.</p>;
  }
  return (
    <section className="card">
      <h2>3. Resultado</h2>
      <div>{content}</div>
    </section>
  );
}
