import { useEffect, useState } from 'react';

export const COMPACT_QUERY = '(max-width: 760px)';
export const TOUCH_QUERY = '(pointer: coarse)';

const read = (query) => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => read(query));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
