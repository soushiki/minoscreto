import { useState } from 'react';
import FileButton from './FileButton.jsx';

export default function DropZone({ text, buttonLabel, accept, onFile }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <span>{text}</span>
      <FileButton accept={accept} onFile={onFile}>{buttonLabel}</FileButton>
    </div>
  );
}
