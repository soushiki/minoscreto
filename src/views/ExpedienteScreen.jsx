import DropZone from '../components/DropZone.jsx';
import CategoryList from './anonymize/CategoryList.jsx';
import SummaryCard from './expediente/SummaryCard.jsx';
import ExpSearchCard from './expediente/ExpSearchCard.jsx';
import OcrCard from './expediente/OcrCard.jsx';
import ExportCard from './expediente/ExportCard.jsx';
import PreviewCard from './expediente/PreviewCard.jsx';

const PDF = '.pdf,application/pdf';

function Intro({ vm }) {
  return (
    <section className="card xp-intro">
      <h2>Expediente en PDF</h2>
      <p className="sub">
        Para expedientes largos (hasta cientos de folios) ya pasados por OCR en Adobe Acrobat. Minoscreto lee el texto de cada folio,
        lo anonimiza aquí mismo y lo exporta como texto listo para subir a la IA: en un solo archivo o dividido en partes con las mismas etiquetas.
      </p>
      <DropZone text="Arrastra el PDF aquí o" buttonLabel="Elegir PDF" accept={PDF} onFile={vm.loadFile} />
      <p className="muted mt">El documento no sale de este navegador. Si un folio es una imagen sin texto, te avisaremos para que le hagas OCR primero.</p>
    </section>
  );
}

function Progress({ vm }) {
  const { done, total } = vm.progress;
  const reading = vm.status === 'reading';
  const pct = reading && total ? Math.round((done / total) * 100) : 100;
  return (
    <section className="card xp-progress" aria-live="polite">
      <h2>{vm.name}</h2>
      <p className="sub">{reading ? (total ? `Leyendo folio ${done} de ${total}…` : 'Abriendo el PDF…') : 'Buscando datos personales en todo el expediente…'}</p>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
      <div className="row-btns"><button type="button" className="btn" onClick={vm.cancel}>Cancelar</button></div>
    </section>
  );
}

export default function ExpedienteScreen({ vm }) {
  if (vm.status === 'idle') return <main><div className="wrap xp-solo"><Intro vm={vm} /></div></main>;
  if (vm.status !== 'ready') return <main><div className="wrap xp-solo"><Progress vm={vm} /></div></main>;
  return (
    <main>
      <div className="wrap">
        <div className="layout xp">
          <aside className="side">
            <SummaryCard vm={vm} />
            <ExpSearchCard vm={vm} />
            <OcrCard vm={vm} />
            <CategoryList vm={vm} />
          </aside>
          <div className="xp-main">
            <ExportCard vm={vm} />
            <PreviewCard vm={vm} />
          </div>
        </div>
      </div>
    </main>
  );
}
