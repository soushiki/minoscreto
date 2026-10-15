import { useCallback, useState } from 'react';
import { useToast } from './viewmodels/useToast.js';
import { useDownloads } from './viewmodels/useDownloads.js';
import { useAnonymizer } from './viewmodels/useAnonymizer.js';
import { useRestorer } from './viewmodels/useRestorer.js';
import { useExpediente } from './viewmodels/useExpediente.js';
import { useFileDrop } from './utils/useFileDrop.js';
import Header from './views/Header.jsx';
import AnonymizeScreen from './views/AnonymizeScreen.jsx';
import RestoreScreen from './views/RestoreScreen.jsx';
import ExpedienteScreen from './views/ExpedienteScreen.jsx';
import Toast from './components/Toast.jsx';
import DropVeil from './components/DropVeil.jsx';

export default function App() {
  const [screen, setScreen] = useState('anonymize');
  const { toast, show } = useToast();
  const save = useDownloads(show);
  const anonymizer = useAnonymizer({ save, notify: show });
  const restorer = useRestorer({ save, notify: show });
  const expediente = useExpediente({ save, notify: show });
  // De qué pantalla viene el diccionario que ofrece Restaurar: la última que se usó.
  const [source, setSource] = useState('anonymize');

  const changeScreen = (next) => {
    anonymizer.actions.closePopover();
    if (next !== 'restore') setSource(next);
    setScreen(next);
    window.scrollTo(0, 0);
  };

  const { loadFile: loadDocx } = anonymizer;
  const { loadFile: loadPdf } = expediente;
  // En Expediente entra PDF o Word; en Anonimizar, un PDF se manda a Expediente.
  const onDrop = useCallback((file) => {
    if (screen === 'expediente' || /\.pdf$/i.test(file.name)) { setScreen('expediente'); setSource('expediente'); loadPdf(file); } else loadDocx(file);
  }, [screen, loadDocx, loadPdf]);
  const dragging = useFileDrop(screen !== 'restore', onDrop);

  const current = source === 'expediente' && expediente.loaded
    ? { dictionary: expediente.dictionary, name: expediente.name }
    : { dictionary: anonymizer.dictionary, name: anonymizer.name };

  return (
    <>
      <Header screen={screen} onScreen={changeScreen} anonymizer={anonymizer} />
      {screen === 'anonymize' && <AnonymizeScreen vm={anonymizer} />}
      {screen === 'expediente' && <ExpedienteScreen vm={expediente} />}
      {screen === 'restore' && <RestoreScreen vm={restorer} current={current} />}
      <DropVeil visible={dragging} />
      <Toast toast={toast} />
    </>
  );
}
