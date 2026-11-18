import DropZone from '../../components/DropZone.jsx';
import PasswordDialog from '../../components/PasswordDialog.jsx';
import Segmented from '../../components/Segmented.jsx';

const MODES = [
  { value: 'paste', label: 'Pegar texto' },
  { value: 'word', label: 'Archivo' }
];

export default function ResponseCard({ vm }) {
  return (
    <section className="card">
      <h2>2. Respuesta de la IA</h2>
      <p className="sub">Pega el texto que te devolvió la IA, o sube el archivo (Word o PDF) que generó.</p>
      <Segmented options={MODES} value={vm.mode} onChange={vm.setMode} label="Origen de la respuesta" />
      <div className="mt">
        {vm.mode === 'paste' ? (
          <textarea className="paste" value={vm.pasted} onChange={(e) => vm.setPasted(e.target.value)}
            placeholder="Pega aquí la respuesta, con las etiquetas como [PERSONA_1]" spellCheck={false} />
        ) : (
          <DropZone text="Arrastra el archivo aquí o" buttonLabel="Elegir archivo (.docx o .pdf)"
            accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onFile={vm.readWordFile} />
        )}
      </div>
      <PasswordDialog prompt={vm.passwordPrompt.prompt} onSubmit={vm.passwordPrompt.submit} onCancel={vm.passwordPrompt.cancel} />
    </section>
  );
}
