import { useRef } from 'react';

export default function FileButton({ accept, onFile, className = 'btn', children }) {
  const input = useRef(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current.click()}>{children}</button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = '';
          onFile(file);
        }}
      />
    </>
  );
}
