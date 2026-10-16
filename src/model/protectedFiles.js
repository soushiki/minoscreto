// Archivos que se descargan al anonimizar: el documento protegido y su diccionario, con nombres que se ordenan juntos.
import JSZip from 'jszip';
import { parseDictionary } from './dictionary.js';

export const safeName = (name) => String(name || '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documento';

export const protectedFileName = (name, ext) => `${safeName(name)}_protegido.${ext}`;
export const dictionaryFileName = (name) => `${safeName(name)}_diccionario.json`;

export const dictionaryJson = (dictionary) => JSON.stringify(dictionary, null, 2);

const isZip = (bytes) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/**
 * Lee un diccionario desde lo que el usuario cargue: el .json o .txt del diccionario, o el .zip de un
 * expediente en partes (busca dentro el archivo del diccionario). Devuelve el objeto LLAVE → VALOR.
 */
export async function readDictionaryFrom(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isZip(bytes)) return parseDictionary(new TextDecoder('utf-8').decode(bytes));
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('No se pudo abrir el archivo comprimido.');
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const pick = names.find((n) => /diccionario[^/]*\.json$/i.test(n)) || names.find((n) => /diccionario[^/]*\.txt$/i.test(n));
  if (!pick) {
    if (names.some((n) => n === 'word/document.xml')) throw new Error('Este es un documento de Word, no el diccionario.');
    throw new Error('Este archivo comprimido no trae un diccionario.');
  }
  return parseDictionary(await zip.file(pick).async('string'));
}
