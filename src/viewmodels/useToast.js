import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, isError = false) => {
    clearTimeout(timer.current);
    setToast({ message, isError });
    timer.current = setTimeout(() => setToast(null), isError ? 7000 : 4200);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show };
}
