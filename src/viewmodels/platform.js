/**
 * iPhone, iPod o iPad (el iPad con iPadOS 13+ se presenta como «MacIntel», pero tiene pantalla táctil).
 * Safari en estos equipos descarta una descarga que no nace de un toque, como la del diccionario tras la pausa.
 */
export function isAppleTouch(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav) return false;
  if (/iPad|iPhone|iPod/.test(nav.userAgent || '')) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}
