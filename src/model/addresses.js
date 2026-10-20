// Direcciones colombianas: «Calle 45 # 12-30», «Cra. 7 No. 71-21 Apto 502», «Av. Carrera 68 N° 24 - 10 Sur»,
// «Dg 15 Bis A #45-20, Barrio La Floresta», «Mz 4 Casa 12», «Km 5 vía La Calera». En mayúsculas, minúsculas o mezcla.
import { fold } from './text.js';
import { STOP_WORDS, SENTENCE_STARTERS, COMMON_CAPS } from './lexicon.js';

const B = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}])';
const STREET = `(?:av(?:enida|\\.)?\\s+(?:calle|carrera|cra|kra|cll|cl|kr|ak|ac)|avenida|autopista|calle|carrera|diagonal|transversal|circular`
  + `|cll|cl|cra|kra|kr|cr|av|ak|ac|dg|tv|tr|cq)\\.?${END}`;
const SUFFIX = `(?:\\s?[a-z]${END})?(?:\\s?bis${END})?(?:\\s?[a-z]${END})?`;
const CARDINAL = `(?:\\s+(?:sur|este|norte|oeste)${END})?`;
const SEPARATOR = '\\s*(?:#|n[°º]\\.?|no\\.?|n[uú]m(?:ero)?\\.?)?\\s*';
// La letra final de la placa va pegada («12-30A»): con espacio sería la «y» o una línea basura que sigue.
const PLATE = `\\d{1,3}${SUFFIX}\\s*(?:[-–]|\\s)\\s*\\d{1,3}(?:[a-z]${END})?`;

const URBAN = new RegExp(`${B}${STREET}\\s*\\d{1,3}${SUFFIX}${CARDINAL}${SEPARATOR}${PLATE}${CARDINAL}(?![\\p{N}])`, 'giu');
const BLOCK = new RegExp(`${B}(?:manzana|mz)\\.?\\s*[\\p{L}\\p{N}]{1,4}\\s*,?\\s*(?:casa|cs|lote|lt)\\.?\\s*\\d{1,4}(?:\\s?[a-z]${END})?(?![\\p{N}])`, 'giu');
const ROAD = new RegExp(`${B}(?:km|kil[oó]metro)\\.?\\s*\\d{1,3}(?:[.,]\\d{1,3})?\\s+(?:de\\s+la\\s+)?(?:v[ií]a|carretera|autopista)\\s+(?:(?:que\\s+conduce\\s+)?(?:a|al|hacia)\\s+)?`, 'giu');

// Lo que sigue a la dirección: «Apto 502», «Torre 3», «Int. 2», «Of. 301», «Piso 4», «Local 12B».
const UNIT = /^\s*,?\s*(?:apartamento|apto|apt|torre|interior|int|bloque|bl|casa|oficina|of|local|piso|consultorio|etapa|manzana|mz|lote)\.?\s*(?:#|no\.?|n[°º]\.?)?\s*(?:\d[\p{L}\p{N}]{0,4}|[a-z](?![\p{L}]))(?![\p{L}\p{N}])/iu;
// Y un nombre: «, Barrio La Floresta», «Conjunto Los Pinos», «vereda El Salitre».
const PLACE = /^\s*,?\s*(?:barrio|br|conjunto|conj|urbanizaci[oó]n|urb|edificio|edif|vereda|sector)\.?\s+/iu;
const NAME_LINKS = new Set(['de', 'del', 'la', 'las', 'los', 'el']);

/** Lee hasta 4 palabras de un nombre desde `from` («La Floresta», «el prado»); devuelve dónde termina (`from` si no hay). */
function nameEnd(text, from) {
  const re = /\s*([\p{L}][\p{L}'’-]*)/uy;
  re.lastIndex = from;
  let end = from;
  let words = 0;
  let firstCapital = null;
  let m;
  while (words < 4 && (m = re.exec(text))) {
    const f = fold(m[1]);
    if (NAME_LINKS.has(f)) continue;
    const capital = m[1][0] !== m[1][0].toLowerCase();
    // Un nombre con mayúscula no sigue en minúscula («Barrio Getsemaní ubicado…»); uno en minúscula no admite palabras vacías.
    if (firstCapital !== null && capital !== firstCapital) break;
    if (!capital && (f.length <= 2 || STOP_WORDS.has(f) || SENTENCE_STARTERS.has(f) || COMMON_CAPS.has(f))) break;
    firstCapital = capital;
    words++;
    end = re.lastIndex;
    if (!/\s/.test(text[end] || '')) break;
  }
  return end;
}

function extend(text, end) {
  for (let guard = 0; guard < 6; guard++) {
    const rest = text.slice(end);
    const unit = UNIT.exec(rest);
    if (unit) { end += unit[0].length; continue; }
    const place = PLACE.exec(rest);
    if (place) {
      const nameStop = nameEnd(text, end + place[0].length);
      if (nameStop > end + place[0].length) { end = nameStop; continue; }
    }
    break;
  }
  return end;
}

/** Marca las direcciones del texto (antes que los demás tipos, para que sus números no se lean como otra cosa). */
export function detectAddresses(text, claims) {
  const take = (start, end) => { if (end > start && claims.isFree(start, end)) claims.claim(start, end, 'DIRECCION'); };
  for (const re of [URBAN, BLOCK]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) take(m.index, extend(text, m.index + m[0].length));
  }
  ROAD.lastIndex = 0;
  let m;
  while ((m = ROAD.exec(text))) {
    const end = nameEnd(text, m.index + m[0].length);
    if (end > m.index + m[0].length) take(m.index, extend(text, end));
  }
}
