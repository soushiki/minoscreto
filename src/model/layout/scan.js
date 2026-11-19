// Revisión de escaneos por página (R5, diseño §3). Una página escaneada (imagen de página completa sin texto
// visible real) no puede dar PDF con diseño: los valores seguirían en la imagen. Basta una para que todo el
// archivo salga como PDF de texto. Los umbrales se calibran en T12; cambiarlos pide el sí del usuario.

/** minVisibleChars: texto visible (modo 0–2) desde el que la página es texto real, aunque tenga imagen de fondo.
 *  minImageCoverage: fracción de la página que cubre la imagen más grande para contar como imagen de página. */
export const SCAN_RULES = Object.freeze({ minVisibleChars: 30, minImageCoverage: 0.9 });

const isCount = (n) => Number.isInteger(n) && n >= 0;
// Fracción recortada a la página; se acepta algo más de 1 por redondeo de coma flotante.
const isFraction = (n) => Number.isFinite(n) && n >= 0;

/**
 * @param {{ visibleChars: number, invisibleChars: number, imageCoverage: number }} stats de `pageStats` del motor
 * @returns {'text' | 'scan'}
 */
export function classifyPage(stats) {
  if (!stats || !isCount(stats.visibleChars) || !isCount(stats.invisibleChars) || !isFraction(stats.imageCoverage)) {
    throw new TypeError('classifyPage: datos de página inválidos');
  }
  if (stats.visibleChars >= SCAN_RULES.minVisibleChars) return 'text';
  // Sin texto visible real: si una imagen cubre la página, lo que se lee está en la imagen (con o sin capa OCR).
  return stats.imageCoverage >= SCAN_RULES.minImageCoverage ? 'scan' : 'text';
}
