import { useCallback, useState } from 'react';
import { useToast } from './viewmodels/useToast.js';
import { useDownloads } from './viewmodels/useDownloads.js';
import { useAnonymizer } from './viewmodels/useAnonymizer.js';
import { useRestorer } from './viewmodels/useRestorer.js';
import { useExpediente } from './viewmodels/useExpediente.js';
import { useWelcome, readGuidePrefs } from './viewmodels/useWelcome.js';
import { useFileDrop } from './utils/useFileDrop.js';
import Header from './views/Header.jsx';
import AnonymizeScreen from './views/AnonymizeScreen.jsx';
import RestoreScreen from './views/RestoreScreen.jsx';
import ExpedienteScreen from './views/ExpedienteScreen.jsx';
import WelcomeScreen from './views/WelcomeScreen.jsx';
import Toast from './components/Toast.jsx';
import DropVeil from './components/DropVeil.jsx';

export default function App() {
  // Quien pidió ir directo a las herramientas no vuelve a ver la guía al abrir.
  const [screen, setScreen] = useState(() => (readGuidePrefs().skip ? 'anonymize' : 'welcome'));
  const { toast, show } = useToast();
  const save = useDownloads(show);
  const anonymizer = useAnonymizer({ save, notify: show });
  const restorer = useRestorer({ save, notify: show });
  const expediente = useExpediente({ save, notify: show });
  // De qué pantalla viene el diccionario que ofrece Restaurar: la última que se usó.
  const [source, setSource] = useState('anonymize');

  const { closePopover } = anonymizer.actions;
  const changeScreen = useCallback((next) => {
    closePopover();
    if (next === 'anonymize' || next === 'expediente') setSource(next);
    setScreen(next);
    window.scrollTo(0, 0);
  }, [closePopover]);

  const { loadFile: loadDocx } = anonymizer;
  const { loadFile: loadPdf } = expediente;
  const { setFormat } = expediente.actions;
  const openShort = useCallback((file) => { changeScreen('anonymize'); loadDocx(file); }, [changeScreen, loadDocx]);
  const openLong = useCallback((file, output) => {
    setFormat(output === 'one' ? 'md' : 'zip');
    changeScreen('expediente');
    loadPdf(file);
  }, [setFormat, changeScreen, loadPdf]);

  const welcome = useWelcome({
    openShort,
    openLong,
    showExample: useCallback(() => changeScreen('anonymize'), [changeScreen]),
    goRestore: useCallback(() => changeScreen('restore'), [changeScreen]),
    goTools: useCallback(() => changeScreen('anonymize'), [changeScreen])
  });
  const { restart } = welcome.actions;
  const goHome = useCallback(() => { restart(); changeScreen('welcome'); }, [restart, changeScreen]);

  // En Expediente entra PDF o Word; en las demás pantallas, un PDF se manda a Expediente y un Word a Anonimizar.
  const onDrop = useCallback((file) => {
    if (screen === 'expediente' || /\.pdf$/i.test(file.name)) openLong(file, expediente.format === 'md' ? 'one' : 'parts');
    else openShort(file);
  }, [screen, openLong, openShort, expediente.format]);
  const dragging = useFileDrop(screen !== 'restore', onDrop);

  const current = source === 'expediente' && expediente.loaded
    ? { dictionary: expediente.dictionary, name: expediente.name }
    : { dictionary: anonymizer.dictionary, name: anonymizer.name };

  return (
    <>
      <Header screen={screen} onScreen={changeScreen} onHome={goHome} anonymizer={anonymizer} />
      {screen === 'welcome' && <WelcomeScreen vm={welcome} />}
      {screen === 'anonymize' && <AnonymizeScreen vm={anonymizer} />}
      {screen === 'expediente' && <ExpedienteScreen vm={expediente} />}
      {screen === 'restore' && <RestoreScreen vm={restorer} current={current} />}
      <DropVeil visible={dragging} />
      <Toast toast={toast} />
    </>
  );
}
