// Recorre el modo expediente de punta a punta en Node con un PDF real y mide tiempos, reducción y fugas.
// Uso: node scripts/bench-expediente.mjs .local/expediente-600.pdf [.local/expediente-600.verdad.json]
// FIXOCR=0 desactiva la corrección de 0/1 dentro de palabras, para comparar.
import { readFileSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildEntities, buildDictionary, fold } from '../src/model/index.js';
import {
  itemsToLines, buildDocument, anonymizeTexts, splitParts, renderParts, buildPartsZip, findOcrVariants, renderWhole,
  acceptOcrVariant, tidyEntities
} from '../src/model/expediente/index.js';

const [pdfPath, truthPath] = process.argv.slice(2);
const fixOcr = process.env.FIXOCR !== '0';
const ms = (t) => `${Math.round(performance.now() - t)} ms`;
const report = {};

let t = performance.now();
const pdf = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise;
const pages = [];
for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  pages.push({ number: n, lines: itemsToLines((await page.getTextContent()).items) });
  page.cleanup();
}
report.read = ms(t);

t = performance.now();
const full = buildDocument(pages, { fixOcr });
const reduced = buildDocument(pages, { reduce: true, fixOcr });
report.layout = ms(t);
report.ocrDigitFixes = full.ocrFixes;
report.paragraphs = { full: full.paragraphs.length, reduced: reduced.paragraphs.length };
report.tokens = { full: full.tokens, reduced: reduced.tokens, saved: `${Math.round((1 - reduced.tokens / full.tokens) * 100)}%` };
report.removed = reduced.removed;
report.emptyPages = full.emptyPages;

t = performance.now();
let entities = tidyEntities(buildEntities(full.paragraphs));
report.detect = ms(t);
report.entities = entities.length;

const texts = reduced.paragraphs.map((p) => p.text);
t = performance.now();
let applied = anonymizeTexts(texts, entities);
report.apply = ms(t);

t = performance.now();
const variants = findOcrVariants(texts, entities);
report.ocrVariantsTime = ms(t);
report.ocrVariants = variants.length;
report.ocrMergeSuggestions = variants.filter((v) => v.mergeFrom).length;

const leaks = (out, truth) => {
  const all = fold(out.join('\n'));
  const count = (s) => all.split(fold(s)).length - 1;
  const people = Object.keys(truth.people).reduce((n, p) => n + count(p), 0);
  const ocr = [...new Set(truth.ocrVariants.map((v) => v.ocr))];
  const ocrLeft = ocr.filter((v) => count(v) > 0);
  const ids = truth.ids.filter((id) => count(id) > 0);
  // Cualquier palabra de un nombre sembrado (o de su versión con errores) que siga en el texto es una fuga.
  const words = new Set([...Object.keys(truth.people), ...ocr].flatMap((n) => n.split(' ')).filter((w) => w.length >= 4).map(fold));
  const left = new Map();
  for (const w of all.match(/[\p{L}\p{N}]+/gu) || []) if (words.has(w)) left.set(w, (left.get(w) || 0) + 1);
  return {
    fullNamesLeft: people, ocrVariantsPlanted: ocr.length, ocrVariantsLeft: ocrLeft.length, idsLeft: ids.length,
    nameWordsLeft: [...left.values()].reduce((a, b) => a + b, 0), sampleWords: [...left].slice(0, 10)
  };
};

if (truthPath) {
  const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
  report.peoplePlanted = Object.keys(truth.people).length;
  report.personEntitiesBefore = entities.filter((e) => e.type === 'PERSONA').length;
  report.leaksBefore = leaks(applied.texts, truth);
  for (let round = 0; round < 3; round++) {
    const found = findOcrVariants(texts, entities);
    if (!found.length) break;
    for (const v of found) if (entities.some((e) => e.id === v.entityId) && (!v.mergeFrom || entities.some((e) => e.id === v.mergeFrom))) entities = acceptOcrVariant(entities, v);
  }
  applied = anonymizeTexts(texts, entities);
  report.personEntitiesAfter = entities.filter((e) => e.type === 'PERSONA').length;
  report.leaksAfterOcrSuggestions = leaks(applied.texts, truth);
}

t = performance.now();
const blocks = reduced.paragraphs.map((p, i) => ({ ...p, index: i, text: applied.texts[i] }));
const parts = splitParts(blocks, { mode: 'sections', maxTokens: 50000, overlap: 2 });
const rendered = renderParts({ blocks, parts, emptyPages: reduced.emptyPages });
const dictionary = buildDictionary(entities, new Set(applied.usedIds));
const zip = await buildPartsZip({ name: 'expediente', parts: rendered, dictionary, type: 'nodebuffer' });
report.export = ms(t);
report.parts = rendered.map((p) => `${p.number}: folios ${p.first}-${p.last} ~${parts[p.number - 1].tokens} tok`);
report.zipBytes = zip.length;
writeFileSync('.local/expediente-partes.zip', zip);
writeFileSync('.local/expediente-completo.md', renderWhole({ name: 'expediente', blocks, emptyPages: reduced.emptyPages }));
console.log(JSON.stringify(report, null, 1));
if (process.env.DUMP) {
  console.log(entities.filter((e) => e.type === 'PERSONA').map((e) => `${e.label}${e.enabled ? '' : ' (off)'} ${e.value} | ${e.aliases.join('; ')}`).join('\n'));
}
