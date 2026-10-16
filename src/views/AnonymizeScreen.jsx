import { useEffect } from 'react';
import Banner from './anonymize/Banner.jsx';
import SearchPanel from './anonymize/SearchPanel.jsx';
import SuggestionsPanel from './anonymize/SuggestionsPanel.jsx';
import CategoryList from './anonymize/CategoryList.jsx';
import ComparisonSheet from './anonymize/ComparisonSheet.jsx';
import Popover from './anonymize/Popover.jsx';
import DownloadReceipt from '../components/DownloadReceipt.jsx';

export default function AnonymizeScreen({ vm }) {
  const { undo, redo } = vm.actions;

  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '');
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  return (
    <main>
      <div className="wrap">
        <Banner vm={vm} />
        <DownloadReceipt receipt={vm.receipt} onDictionaryAgain={vm.downloadDictionaryAgain} />
        <div className="layout">
          <aside className="side">
            <SearchPanel vm={vm} />
            <SuggestionsPanel vm={vm} />
            <CategoryList vm={vm} />
          </aside>
          <ComparisonSheet vm={vm} />
        </div>
      </div>
      <Popover vm={vm} />
    </main>
  );
}
