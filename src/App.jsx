import { useState } from 'react';
import { useToast } from './viewmodels/useToast.js';
import { useDownloads } from './viewmodels/useDownloads.js';
import { useAnonymizer } from './viewmodels/useAnonymizer.js';
import { useRestorer } from './viewmodels/useRestorer.js';
import { useFileDrop } from './utils/useFileDrop.js';
import Header from './views/Header.jsx';
import AnonymizeScreen from './views/AnonymizeScreen.jsx';
import RestoreScreen from './views/RestoreScreen.jsx';
import Toast from './components/Toast.jsx';
import DropVeil from './components/DropVeil.jsx';

export default function App() {
  const [screen, setScreen] = useState('anonymize');
  const { toast, show } = useToast();
  const save = useDownloads(show);
  const anonymizer = useAnonymizer({ save, notify: show });
  const restorer = useRestorer({ save, notify: show });
  const dragging = useFileDrop(screen === 'anonymize', anonymizer.loadFile);

  const changeScreen = (next) => {
    anonymizer.actions.closePopover();
    setScreen(next);
    window.scrollTo(0, 0);
  };

  return (
    <>
      <Header screen={screen} onScreen={changeScreen} anonymizer={anonymizer} />
      {screen === 'anonymize'
        ? <AnonymizeScreen vm={anonymizer} />
        : <RestoreScreen vm={restorer} current={{ dictionary: anonymizer.dictionary, name: anonymizer.name }} />}
      <DropVeil visible={dragging} />
      <Toast toast={toast} />
    </>
  );
}
