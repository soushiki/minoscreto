import FileButton from '../components/FileButton.jsx';
import { BackIcon, KeyIcon, LockIcon, PageIcon, PartsIcon, ShieldIcon, StackIcon } from '../components/Icons.jsx';

const WORD = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf';
const LONG = '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function Choice({ icon, title, text, onClick, tag }) {
  return (
    <button type="button" className="wl-choice" onClick={onClick}>
      <span className="wl-icon">{icon}</span>
      <span className="wl-ctext">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      {tag && <span className="wl-tag">{tag}</span>}
    </button>
  );
}

function Start({ vm }) {
  return (
    <>
      <h1>Bienvenido a Minoscreto</h1>
      <p className="wl-lead">
        Minoscreto reemplaza los nombres, cédulas y demás datos personales de sus documentos antes de que usted los use con
        una inteligencia artificial, y después le ayuda a recuperarlos.
      </p>
      <p className="wl-safe"><LockIcon />Sus documentos nunca salen de este computador.</p>
      <h2>¿Qué le gustaría hacer?</h2>
      <div className="wl-choices">
        <Choice icon={<ShieldIcon />} title="Proteger un documento antes de usar IA"
          text="Cambiamos los datos personales por etiquetas como [PERSONA_1]." onClick={vm.actions.protect} />
        <Choice icon={<KeyIcon />} title="Recuperar los nombres reales"
          text="Pegue la respuesta de la IA y le devolvemos los nombres originales." onClick={vm.actions.restore} />
      </div>
    </>
  );
}

function Length({ vm }) {
  const last = vm.lastLength;
  return (
    <>
      <h1>¿Qué tan largo es su documento?</h1>
      <p className="wl-lead">Así le mostramos el camino más sencillo.</p>
      <div className="wl-choices">
        <Choice icon={<PageIcon />} title="Corto" text="Hasta unas 30 páginas: un contrato, una carta, un memorial."
          onClick={() => vm.actions.chooseLength('short')} tag={last === 'short' ? 'La última vez' : null} />
        <Choice icon={<StackIcon />} title="Largo" text="Expedientes, contratos extensos, cientos de páginas."
          onClick={() => vm.actions.chooseLength('long')} tag={last === 'long' ? 'La última vez' : null} />
      </div>
    </>
  );
}

function Short({ vm }) {
  return (
    <>
      <h1>Elija su documento</h1>
      <p className="wl-lead">
        Abra su archivo de Word. Verá el texto a un lado y la versión protegida al otro, para revisar qué se cambió
        antes de descargarla. Si lo tiene en PDF, también sirve.
      </p>
      <div className="wl-actions">
        <FileButton accept={WORD} onFile={vm.openFile} className="btn primary wl-big">Elegir mi documento</FileButton>
        <button type="button" className="btn wl-big" onClick={vm.showExample}>Ver primero un ejemplo</button>
      </div>
      <p className="wl-hint">También puede arrastrar el archivo a esta ventana.</p>
    </>
  );
}

function Long({ vm }) {
  const { output } = vm;
  return (
    <>
      <h1>Documentos largos</h1>
      <p className="wl-lead">
        Minoscreto convierte su documento en texto protegido que ChatGPT, Claude o Gemini pueden leer rápido. Funciona con PDF
        (escaneado y con texto reconocido) y con Word.
      </p>
      <h2>¿Cómo prefiere recibirlo?</h2>
      <div className="wl-choices" role="radiogroup" aria-label="Cómo recibir el texto">
        <button type="button" role="radio" aria-checked={output === 'parts'} className={`wl-choice wl-radio${output === 'parts' ? ' on' : ''}`} onClick={() => vm.actions.chooseOutput('parts')}>
          <span className="wl-icon"><PartsIcon /></span>
          <span className="wl-ctext">
            <strong>En partes para la IA <span className="wl-rec">Recomendado</span></strong>
            <span>Varias partes numeradas que se suben una tras otra. Casi ningún chat acepta un documento tan largo de una sola vez.</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={output === 'one'} className={`wl-choice wl-radio${output === 'one' ? ' on' : ''}`} onClick={() => vm.actions.chooseOutput('one')}>
          <span className="wl-icon"><PageIcon /></span>
          <span className="wl-ctext">
            <strong>Un solo archivo</strong>
            <span>Todo junto. Útil para guardarlo, o si su programa de IA acepta documentos muy largos.</span>
          </span>
        </button>
      </div>
      <div className="wl-actions">
        <FileButton accept={LONG} onFile={vm.openFile} className="btn primary wl-big">Elegir mi documento</FileButton>
      </div>
      <p className="wl-hint">Puede cambiar esta elección después, antes de descargar.</p>
    </>
  );
}

const STEPS = { start: Start, length: Length, short: Short, long: Long };

export default function WelcomeScreen({ vm }) {
  const Step = STEPS[vm.step] || Start;
  return (
    <main className="wl">
      <div className="wrap wl-wrap">
        <div className="wl-nav">
          {vm.canGoBack
            ? <button type="button" className="btn ghost wl-back" onClick={vm.actions.back}><BackIcon />Volver</button>
            : <span />}
          <button type="button" className="btn ghost wl-skip" onClick={vm.actions.skip}>Ir directo a las herramientas</button>
        </div>
        <section className="card wl-card" aria-live="polite">
          <Step vm={vm} />
        </section>
      </div>
    </main>
  );
}
