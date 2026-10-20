import FileButton from '../../components/FileButton.jsx';

const DOCX = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export default function Banner({ vm }) {
  const w = vm.warnings;
  return (
    <div className="banner">
      {vm.isSample && (
        <div className="note info">
          <p><strong>Contrato de ejemplo con datos inventados.</strong> Haz clic en cualquier palabra del lado izquierdo para anonimizarla (prueba con «artesanías»), o abre tu propio Word.</p>
          <FileButton accept={DOCX} onFile={vm.loadFile} className="btn primary">Abrir mi Word</FileButton>
        </div>
      )}
      {w?.tracked > 0 && (
        <div className="note"><p>Este documento tiene <strong>control de cambios</strong>. El texto eliminado también se anonimiza, pero revisa el resultado en Word antes de enviarlo.</p></div>
      )}
      {w?.comments > 0 && (
        <div className="note"><p>Tiene <strong>comentarios</strong>. Aparecen abajo como «Comentario» y también se anonimizan.</p></div>
      )}
      {w?.images > 0 && (
        <div className="note"><p>Contiene <strong>{w.images} {w.images > 1 ? 'imágenes' : 'imagen'}</strong> (firmas, sellos o escaneos). Las imágenes no se pueden anonimizar: revísalas o elimínalas en Word.</p></div>
      )}
    </div>
  );
}
