import DictionaryCard from './restore/DictionaryCard.jsx';
import ResponseCard from './restore/ResponseCard.jsx';
import ResultCard from './restore/ResultCard.jsx';

export default function RestoreScreen({ vm, current }) {
  return (
    <main>
      <div className="wrap rs">
        <div className="rs-col">
          <DictionaryCard vm={vm} current={current} />
          <ResponseCard vm={vm} />
        </div>
        <div className="rs-col">
          <ResultCard vm={vm} />
        </div>
      </div>
    </main>
  );
}
