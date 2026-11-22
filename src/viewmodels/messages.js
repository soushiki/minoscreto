import { formatPageRanges } from '../model/expediente/document.js';

// Avisos que salen en más de una pantalla: un solo texto (review-checklist 8, FIX-8).
export const OMITTED_CHARS = 'Algunos caracteres no se pueden escribir en el PDF y se omitieron. Revisa el archivo.';

// PDF con diseño original (R1, R4, R9, R10): lo que se lee en la lista de descarga (aria-live).
export const LAYOUT_PREPARING = 'Preparando el PDF con su diseño original…';
export const layoutProgress = (done, total) => `Preparando el PDF con su diseño original: página ${done} de ${total}…`;
export const LAYOUT_OK = 'PDF con diseño original';
export const imagePagesNote = (pages) => {
  const n = pages.length;
  return `${n} ${n === 1 ? 'página tiene' : 'páginas tienen'} imágenes (${n === 1 ? 'página' : 'páginas'} ${formatPageRanges(pages)}): revíselas antes de enviar, una imagen puede mostrar datos que no se cambiaron.`;
};

const TEXT_PDF = 'Se descargó el PDF de texto.';
/** Por qué no salió el PDF con diseño, una frase por razón de LayoutRefused, más la cancelación de la contraseña. */
export const LAYOUT_FALLBACK = Object.freeze({
  scan: (pages = []) => `${pages.length ? `${pages.length === 1 ? 'La página' : 'Las páginas'} ${formatPageRanges(pages)} ${pages.length === 1 ? 'es una imagen escaneada' : 'son imágenes escaneadas'}` : 'El PDF tiene páginas escaneadas'}: su diseño no se puede proteger. ${TEXT_PDF}`,
  'missed-value': `Un dato quedaría a la vista en el PDF con diseño (por ejemplo, partido entre dos líneas). Por seguridad, ${TEXT_PDF.charAt(0).toLowerCase()}${TEXT_PDF.slice(1)}`,
  engine: `El PDF con diseño no se pudo preparar en este navegador. ${TEXT_PDF}`,
  'too-large': `El archivo es demasiado grande para el PDF con diseño. ${TEXT_PDF}`,
  error: `No se pudo hacer el PDF con diseño. ${TEXT_PDF}`,
  'password-cancel': `Sin la contraseña no se puede hacer el PDF con diseño. ${TEXT_PDF}`
});
