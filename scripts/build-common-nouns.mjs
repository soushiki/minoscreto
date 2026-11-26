// Genera src/model/data/common-nouns.txt: palabras comunes del español (FrequencyWords es_50k) que el diccionario
// Hunspell es_CO reconoce. Solo en tiempo de build; ni el diccionario ni la lista de frecuencias viajan con la app.
// Uso: npm run nouns [-- --freq <es_50k.txt> --dic <es_CO.dic> --aff <es_CO.aff>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fold } from '../src/model/text.js';
import { FIRST_NAMES } from '../src/model/lexicon.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'src/model/data/common-nouns.txt');
const LIMIT = 50000;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const freqPath = opt('freq', 'D:/github/FrequencyWords/es_50k.txt');
const dicPath = opt('dic', 'D:/github/libreoffice-dictionaries-es/es_CO.dic');
const affPath = opt('aff', dicPath.replace(/\.dic$/, '.aff'));

// Candidatas: palabras de letras, sin repetir (por su forma plegada), de 2 letras o más, que no son nombres de pila.
// Se guardan con su ortografía original (con tilde): así las reconoce Hunspell; el lexicon las pliega al cargarlas.
function candidates() {
  const seen = new Set();
  const list = [];
  for (const line of readFileSync(freqPath, 'utf8').split(/\r?\n/)) {
    const word = line.trim().split(/\s+/)[0];
    if (!word || !/^\p{L}+$/u.test(word)) continue;
    const folded = fold(word);
    if (folded.length < 2 || seen.has(folded) || FIRST_NAMES.has(folded)) continue;
    seen.add(folded);
    list.push(word);
    if (list.length >= LIMIT) break;
  }
  return list;
}

// Formas que genera es_CO (sufijos a 2 niveles y prefijos), como en .local/nouns/filter.py.
function hunspellForms() {
  const sfx = new Map();
  const pfx = new Map();
  const cross = new Map();
  for (const line of readFileSync(affPath, 'utf8').split(/\r?\n/)) {
    const p = line.split(/\s+/).filter(Boolean);
    if (!['SFX', 'PFX'].includes(p[0])) continue;
    if (p.length === 4) cross.set(`${p[0]} ${p[1]}`, p[2] === 'Y');
    else if (p.length >= 5) {
      const strip = p[2] === '0' ? '' : p[2];
      const [rawAdd, ...rest] = p[3].split('/');
      const add = rawAdd === '0' ? '' : rawAdd;
      const cont = rest.join('/');
      const table = p[0] === 'SFX' ? sfx : pfx;
      const cond = p[0] === 'SFX' ? new RegExp(`${p[4]}$`, 'u') : new RegExp(`^${p[4]}`, 'u');
      if (!table.has(p[1])) table.set(p[1], []);
      table.get(p[1]).push({ strip, add, cond, cont });
    }
  }
  function* suffixed(word, flags, depth) {
    yield [word, true];
    for (const f of flags) {
      for (const { strip, add, cond, cont } of sfx.get(f) ?? []) {
        if (cond.test(word) && word.endsWith(strip)) {
          const w = word.slice(0, word.length - strip.length) + add;
          if (cont && depth > 1) yield* suffixed(w, cont, depth - 1);
          else yield [w, cross.get(`SFX ${f}`) ?? false];
        }
      }
    }
  }
  const forms = new Set();
  for (const l of readFileSync(dicPath, 'utf8').split('\n').slice(1)) {
    if (!l.trim()) continue;
    const token = l.trim().split(/\s+/)[0];
    const slash = token.indexOf('/');
    const stem = slash < 0 ? token : token.slice(0, slash);
    const flags = slash < 0 ? '' : token.slice(slash + 1);
    if (stem !== stem.toLowerCase()) continue;
    for (const [w, crossable] of suffixed(stem, flags, 2)) {
      forms.add(w);
      if (!crossable) continue;
      for (const f of flags) {
        if (!pfx.has(f) || !cross.get(`PFX ${f}`)) continue;
        for (const { strip, add, cond } of pfx.get(f)) if (cond.test(w) && w.startsWith(strip)) forms.add(add + w.slice(strip.length));
      }
    }
    for (const f of flags) {
      for (const { strip, add, cond } of pfx.get(f) ?? []) if (cond.test(stem) && stem.startsWith(strip)) forms.add(add + stem.slice(strip.length));
    }
  }
  return forms;
}

const forms = hunspellForms();
const keep = candidates().filter((w) => forms.has(w));
const header = [
  '# Source: FrequencyWords es_50k (Hermit Dave, https://github.com/hermitdave/FrequencyWords), CC BY-SA 4.0',
  '# Filtered with LibreOffice es_CO Hunspell dictionary (build time only)',
  '# This list is CC BY-SA 4.0',
  '# Regenerate: npm run nouns'
];
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${[...header, ...keep].join('\n')}\n`, 'utf8');
console.log(`common-nouns.txt: ${keep.length} words`);
