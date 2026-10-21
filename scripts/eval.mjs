// Mide la detección con documentos reales: recall (lo que importa) y precisión por tipo, por documento y en total.
// Los documentos y sus etiquetas viven fuera del repo (datos personales, Ley 1581): nunca se escriben aquí.
//
// Uso: MINOSCRETO_CORPUS=D:/Claude/anonimizador/corpus npm run eval [-- --dump] [-- --only s01,s02]
//   corpus/docs/<id>-*.pdf|.txt    documentos (si existe <id>-*.ocr.pdf se usa en vez del escaneo sin texto)
//   corpus/gold/<id>.json          { items: [{ type, text, page, uncertain?, optional?, note? }] }  (page: número o lista)
//                                  optional: puede ocultarse o no (entidades públicas, números de contrato);
//                                  no cuenta para el recall, pero detectarlo no es un falso positivo.
//   --dump                         escribe corpus/work/<id>.txt (texto por folio) y <id>.detected.json para etiquetar
//   MODEL_DIR=<carpeta src/model>  mide otra versión del detector (p. ej. un `git archive` de otra rama en .local/)
//   LABEL=<nombre>                 nombre del informe: corpus/reports/<LABEL>.md y .json
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const corpus = process.env.MINOSCRETO_CORPUS;
if (!corpus || !existsSync(join(corpus, 'docs'))) {
  console.error('Falta MINOSCRETO_CORPUS (carpeta con docs/ y gold/, fuera del repo).');
  process.exit(1);
}
if (resolve(corpus).toLowerCase().startsWith(resolve('.').toLowerCase())) {
  console.error('El corpus no puede estar dentro del repo: tiene datos personales reales.');
  process.exit(1);
}
const args = process.argv.slice(2);
const dump = args.includes('--dump');
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const modelDir = resolve(process.env.MODEL_DIR || 'src/model');
const label = process.env.LABEL || 'actual';
const model = await import(pathToFileURL(join(modelDir, 'index.js')).href);
const exp = await import(pathToFileURL(join(modelDir, 'expediente', 'index.js')).href);
const { buildEntities, fold, findOccurrences, toNeedles } = model;
const tidy = exp.tidyEntities || ((e) => e);

const TYPES = ['PERSONA', 'CEDULA', 'NIT', 'DIRECCION', 'TELEFONO', 'CORREO', 'CUENTA', 'EMPRESA', 'NOMBRE', 'RADICADO', 'PLACA', 'OTRO'];

async function pdfPages(path) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push({ number: n, lines: exp.itemsToLines((await page.getTextContent()).items) });
    page.cleanup();
  }
  return pages;
}

/** Párrafos { text, page, endPage } como los arma el modo expediente (sin reducir: se mide todo el texto). */
async function readDoc(id) {
  const files = readdirSync(join(corpus, 'docs')).filter((f) => f.startsWith(`${id}-`));
  const ocr = files.find((f) => /\.ocr\.pdf$/i.test(f));
  const pdf = files.find((f) => /\.pdf$/i.test(f) && !/\.ocr\.pdf$/i.test(f));
  const txt = files.find((f) => /\.txt$/i.test(f));
  if (pdf) {
    let pages = await pdfPages(join(corpus, 'docs', pdf));
    const empty = exp.findEmptyPages(pages);
    let source = pdf;
    if (empty.length && ocr) { pages = await pdfPages(join(corpus, 'docs', ocr)); source = ocr; }
    const built = exp.buildDocument(pages, { fixOcr: true });
    return { source, paragraphs: built.paragraphs, hints: built.hints || [], emptyPages: exp.findEmptyPages(pages), pages: pages.length };
  }
  if (txt) {
    // Texto plano: «\f» separa folios, las líneas en blanco separan párrafos.
    const paragraphs = readFileSync(join(corpus, 'docs', txt), 'utf8').split('\f').flatMap((page, i) =>
      page.split(/\n\s*\n/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).map((text) => ({ text, page: i + 1, endPage: i + 1 })));
    return { source: txt, paragraphs, emptyPages: [], pages: Math.max(...paragraphs.map((p) => p.page)) };
  }
  return null;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Busca el texto etiquetado tolerando espacios y saltos distintos; fold conserva las posiciones. */
function locate(text, needle) {
  const words = fold(needle).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const re = new RegExp(words.map(escape).join('\\s*'), 'g');
  const out = [];
  const folded = fold(text);
  let m;
  while ((m = re.exec(folded))) { out.push([m.index, m.index + m[0].length]); re.lastIndex = m.index + 1; }
  return out;
}

const significant = (text, s, e) => { const out = []; for (let k = s; k < e; k++) if (/[\p{L}\p{N}]/u.test(text[k])) out.push(k); return out; };
const context = (text, s, e) => `…${text.slice(Math.max(0, s - 50), s)}⟦${text.slice(s, e)}⟧${text.slice(e, e + 50)}…`.replace(/\n/g, ' ¶ ').replace(/\s+/g, ' ');

function evaluate(id, doc, gold) {
  const entities = tidy(buildEntities(doc.paragraphs, { hints: doc.hints || [] }));
  const needles = toNeedles(entities);
  const byId = new Map(entities.map((e) => [e.id, e]));
  // Todo el documento en un texto (párrafos separados por «\n»): un dato etiquetado puede quedar partido
  // entre dos párrafos (p. ej. líneas de OCR sueltas), y eso también hay que medirlo.
  let text = '';
  const spans = doc.paragraphs.map((p) => { const s = text.length; text += `${p.text}\n`; return { s, e: s + p.text.length, page: p.page, endPage: p.endPage ?? p.page }; });
  // Rangos que la app reemplazaría (sólo entidades activas), en posiciones del texto completo.
  const replaced = doc.paragraphs.flatMap((p, pi) => findOccurrences(p.text, needles).filter((o) => byId.get(o.id).enabled)
    .map((o) => ({ start: spans[pi].s + o.start, end: spans[pi].s + o.end, entity: byId.get(o.id), gold: false })));
  const pageAt = (k) => spans.find((sp) => sp.s <= k && k <= sp.e)?.page;

  const items = [];
  for (const g of gold.items) {
    const wanted = g.page == null ? null : [].concat(g.page);
    const inPage = ([s]) => { const sp = spans.find((x) => x.s <= s && s <= x.e); return !wanted || wanted.some((n) => sp.page <= n && n <= sp.endPage); };
    const all = locate(text, g.text);
    let spots = all.filter(inPage);
    const elsewhere = !spots.length && all.length > 0;
    if (elsewhere) spots = all;
    let status = 'notfound';
    let typed = false;
    const leaks = [];
    if (spots.length) {
      let full = 0;
      for (const [s, e] of spots) {
        const cover = replaced.filter((o) => o.start < e && s < o.end);
        cover.forEach((o) => { o.gold = true; });
        if (cover.some((o) => o.entity.type === g.type)) typed = true;
        const open = significant(text, s, e).filter((k) => !cover.some((o) => o.start <= k && k < o.end));
        if (!open.length) full++;
        else leaks.push({ partial: open.length < significant(text, s, e).length, context: context(text, s, e), page: pageAt(s), split: text.slice(s, e).includes('\n') });
      }
      status = full === spots.length ? 'hidden' : (full || leaks.some((l) => l.partial) ? 'partial' : 'missed');
    }
    items.push({ ...g, status, typed, elsewhere, leaks });
  }

  const detections = entities.filter((e) => e.enabled).map((e) => {
    const occ = replaced.filter((o) => o.entity === e);
    return { type: e.type, value: e.value, count: occ.length, tp: occ.some((o) => o.gold) };
  }).filter((d) => d.count);
  return { id, source: doc.source, pages: doc.pages, emptyPages: doc.emptyPages, items, detections };
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
function tally(results) {
  const t = {};
  const row = (type) => (t[type] ||= { gold: 0, hidden: 0, partial: 0, missed: 0, notfound: 0, uncertain: 0, det: 0, tp: 0 });
  for (const r of results) {
    for (const i of r.items) {
      if (i.optional) continue;
      if (i.status === 'notfound') { row(i.type).notfound++; continue; }
      const x = row(i.type);
      x.gold++; x[i.status]++; if (i.uncertain) x.uncertain++;
    }
    for (const d of r.detections) { const x = row(d.type); x.det++; if (d.tp) x.tp++; }
  }
  const all = Object.values(t).reduce((a, x) => { for (const k in x) a[k] = (a[k] || 0) + x[k]; return a; }, {});
  return { byType: t, all };
}

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const goldDir = join(corpus, 'gold');
const ids = [...new Set(readdirSync(join(corpus, 'docs')).map((f) => f.split('-')[0]))].filter((id) => !only || only.has(id)).sort();
const results = [];
for (const id of ids) {
  const doc = await readDoc(id);
  if (!doc) continue;
  if (dump) {
    mkdirSync(join(corpus, 'work'), { recursive: true });
    const byPage = new Map();
    doc.paragraphs.forEach((p) => byPage.set(p.page, [...(byPage.get(p.page) || []), p.text]));
    writeFileSync(join(corpus, 'work', `${id}.txt`), [...byPage].map(([n, ps]) => `=== FOLIO ${n}\n${ps.join('\n')}`).join('\n\n'));
    const ents = tidy(buildEntities(doc.paragraphs, { hints: doc.hints || [] }));
    writeFileSync(join(corpus, 'work', `${id}.detected.json`), JSON.stringify(ents.map(({ type, value, aliases, enabled, weak }) => ({ type, value, aliases, enabled, weak })), null, 1));
    console.log(`${id}: ${doc.source} · ${doc.pages} folios · ${doc.emptyPages.length} sin texto · ${ents.length} entidades`);
    continue;
  }
  const goldPath = join(goldDir, `${id}.json`);
  if (!existsSync(goldPath)) { console.warn(`${id}: sin etiquetas (${goldPath})`); continue; }
  results.push(evaluate(id, doc, JSON.parse(readFileSync(goldPath, 'utf8'))));
}
if (dump) process.exit(0);

const { byType, all } = tally(results);
say(`# Minoscreto · evaluación «${label}» (${new Date().toISOString().slice(0, 10)})`);
say(`Detector: ${modelDir}`);
say(`Documentos: ${results.length}. Un dato cuenta como oculto sólo si todas sus apariciones en su folio quedan reemplazadas. ¶ = salto de párrafo.`);
say();
say('## Por tipo');
say('| tipo | datos | ocultos | parciales | perdidos | recall | detectados | correctos | precisión |');
say('|---|---|---|---|---|---|---|---|---|');
for (const type of [...TYPES, ...Object.keys(byType).filter((k) => !TYPES.includes(k))]) {
  const x = byType[type];
  if (!x) continue;
  say(`| ${type} | ${x.gold} | ${x.hidden} | ${x.partial} | ${x.missed} | ${pct(x.hidden, x.gold)} | ${x.det} | ${x.tp} | ${pct(x.tp, x.det)} |`);
}
say(`| **total** | ${all.gold} | ${all.hidden} | ${all.partial} | ${all.missed} | **${pct(all.hidden, all.gold)}** | ${all.det} | ${all.tp} | **${pct(all.tp, all.det)}** |`);
say();
say('## Por documento');
say('| doc | fuente | folios | sin texto | datos | recall | precisión |');
say('|---|---|---|---|---|---|---|');
for (const r of results) {
  const { all: a } = tally([r]);
  say(`| ${r.id} | ${r.source} | ${r.pages} | ${r.emptyPages.length} | ${a.gold || 0} | ${pct(a.hidden, a.gold)} | ${pct(a.tp, a.det)} |`);
}
say();
say('## Fugas (todo dato no oculto del todo)');
for (const r of results) {
  for (const i of r.items.filter((x) => !x.optional && (x.status === 'missed' || x.status === 'partial'))) {
    for (const l of i.leaks) say(`- ${r.id} f${l.page} ${i.type}${i.uncertain ? ' (dudoso)' : ''}${l.partial ? ' PARCIAL' : ''}${l.split ? ' (partido entre párrafos)' : ''}: ${l.context}`);
  }
}
const notfound = results.flatMap((r) => r.items.filter((i) => i.status === 'notfound' && !i.optional).map((i) => `${r.id} f${i.page} ${i.type} «${i.text}»`));
if (notfound.length) { say(); say('## Etiquetas que no aparecen en el texto (revisar la etiqueta o la lectura del PDF)'); notfound.forEach((n) => say(`- ${n}`)); }
say();
say('## Falsos positivos (detectado y activo, sin dato etiquetado debajo)');
for (const r of results) {
  const fps = r.detections.filter((d) => !d.tp);
  if (fps.length) say(`- ${r.id}: ${fps.map((d) => `${d.type} «${d.value}»`).join(' · ')}`);
}
mkdirSync(join(corpus, 'reports'), { recursive: true });
writeFileSync(join(corpus, 'reports', `${label}.md`), lines.join('\n'));
writeFileSync(join(corpus, 'reports', `${label}.json`), JSON.stringify({ label, modelDir, byType, all, results }, null, 1));
console.log(`\nInforme: ${join(corpus, 'reports', label + '.md')}`);
