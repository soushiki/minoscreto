/** Lista de lo que se descargó, con el recordatorio del diccionario a la vista. */
export default function DownloadReceipt({ receipt, onDictionaryAgain }) {
  if (!receipt) return null;
  const zip = receipt.kind === 'zip';
  const mark = (done) => <span className={`dl-mark${done ? ' ok' : ''}`} aria-hidden="true">{done ? '✓' : '…'}</span>;
  return (
    <div className="dl-receipt" role="status" aria-live="polite">
      <ol>
        <li className={receipt.docDone ? 'ok' : ''}>
          {mark(receipt.docDone)}
          <span><strong>1. {zip ? 'Partes para la IA' : 'Documento protegido'}</strong><small>{receipt.docName}</small></span>
        </li>
        <li className={receipt.dictDone ? 'ok' : ''}>
          {mark(receipt.dictDone)}
          <span><strong>2. Diccionario</strong><small>{zip ? 'Dentro del mismo archivo, en la carpeta NO-SUBIR' : receipt.dictName}</small></span>
        </li>
      </ol>
      <p className="dl-remind"><strong>Guarde el diccionario:</strong> lo necesitará para recuperar los nombres. No lo suba a la IA.</p>
      <div className="dl-again">
        <button type="button" className="btn" onClick={onDictionaryAgain}>Descargar diccionario de nuevo</button>
        {!zip && <span className="muted">Si el navegador preguntó si permite descargar varios archivos, elija «Permitir».</span>}
      </div>
    </div>
  );
}
