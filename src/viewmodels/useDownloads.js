import { useCallback, useRef } from 'react';

export function useDownloads(notify) {
  const capability = useRef(undefined);

  const resolve = useCallback(async () => {
    if (capability.current !== undefined) return capability.current;
    try {
      capability.current = window.claude?.use ? await window.claude.use('downloads') : null;
    } catch {
      capability.current = null;
    }
    return capability.current;
  }, []);

  return useCallback(async (filename, data) => {
    const dl = await resolve();
    if (dl) {
      try {
        await dl.save({ filename, data });
        return true;
      } catch (error) {
        if (error?.code !== 'declined') notify(`No se pudo guardar el archivo (${error?.code || error?.message || 'error'}).`, true);
        return false;
      }
    }
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }, [resolve, notify]);
}
