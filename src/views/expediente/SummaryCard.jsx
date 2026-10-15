import FileButton from '../../components/FileButton.jsx';

const fmt = (n) => n.toLocaleString('es-CO');

export default function SummaryCard({ vm }) {
  const { tokens, removed } = vm;
  const saved = tokens ? Math.round((1 - tokens.reduced / tokens.full) * 100) : 0;
  return (
    <section className="card xp-summary">
      <div className="xp-file">
        <div className="doc"><strong>{vm.name}.pdf</strong><span>{fmt(vm.pageCount)} folios · {fmt(vm.paragraphCount)} párrafos</span></div>
        <FileButton accept=".pdf,application/pdf" onFile={vm.loadFile} className="btn sm">Otro PDF</FileButton>
      </div>

      {vm.emptyPages.length > 0 && (
        <div className="note xp-empty" role="alert">
          <p>
            <strong>{vm.emptyPages.length === 1 ? 'El folio' : `${vm.emptyPages.length} folios`} {vm.emptyRanges} {vm.emptyPages.length === 1 ? 'no tiene' : 'no tienen'} texto.</strong>{' '}
            Seguramente son escaneos sin OCR, así que su contenido no se puede anonimizar ni llegará a la IA. Lo mejor es abrir el PDF en Acrobat,
            usar <em>Escanear y OCR › Reconocer texto</em> y volver a cargarlo.
          </p>
          <label className="chk"><input type="checkbox" checked={vm.ackEmpty} onChange={(e) => vm.actions.setAckEmpty(e.target.checked)} />Entiendo, continuar sin esos folios</label>
        </div>
      )}

      <label className="chk xp-reduce">
        <input type="checkbox" checked={vm.reduce} onChange={(e) => vm.actions.setReduce(e.target.checked)} />
        <span><strong>Reducir tamaño</strong><br /><span className="muted">Quita encabezados y pies repetidos, números de página y basura del OCR.</span></span>
      </label>
      {tokens && (
        <dl className="xp-stats">
          <div><dt>Sin reducir</dt><dd>≈ {fmt(tokens.full)} tokens</dd></div>
          <div><dt>Reducido</dt><dd>≈ {fmt(tokens.reduced)} tokens <span className="muted">(−{saved}%)</span></dd></div>
          {removed && <div className="wide"><dt>Quitado</dt><dd>{fmt(removed.repeated + removed.pageNumbers)} líneas de encabezado, pie o número de página · {fmt(removed.junk)} líneas basura</dd></div>}
          {vm.ocrFixes > 0 && <div className="wide"><dt>OCR</dt><dd>{fmt(vm.ocrFixes)} palabras con 0/1 en lugar de o/l corregidas («J0rge» → «Jorge»)</dd></div>}
        </dl>
      )}
      <p className="muted xp-note">Tokens estimados como caracteres ÷ 4.</p>
    </section>
  );
}
