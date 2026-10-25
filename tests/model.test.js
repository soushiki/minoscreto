import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildDocx, openDocx, buildEntities, exportAnonymized, restoreDocx, restoreText, buildDictionary,
  dictionaryToText, parseDictionary, analyze, findSuggestions, findHits, addValue, renameLabel,
  setCategoryEnabled, retype, createEntity, addAlias, SAMPLE_PARAGRAPHS, findOccurrences, detect,
  collectSources, dictionaryVariants, dictionaryJson
} from '../src/model/index.js';
import { anonymizeTexts } from '../src/model/expediente/index.js';

const textsOf = async (blob) => {
  const doc = await openDocx(await blob.arrayBuffer());
  return doc.paragraphs.map((p) => p.text);
};

describe('detección', () => {
  it('reconoce los datos del contrato de ejemplo', async () => {
    const doc = await openDocx(await buildDocx(SAMPLE_PARAGRAPHS));
    const ents = buildEntities(doc.paragraphs);
    const by = (type) => ents.filter((e) => e.type === type).map((e) => e.value);
    expect(by('PERSONA')).toEqual(['Laura Patricia Ortega Jiménez', 'Carlos Andrés Mendoza Ríos']);
    expect(by('EMPRESA')).toEqual(['Inversiones Bahía del Caribe S.A.S.']);
    expect(by('CEDULA')).toEqual(['45.521.884', '1.047.382.915']);
    expect(by('NIT')).toEqual(['901.234.567-8']);
    expect(by('CORREO')).toEqual(['cmendoza@example.com', 'contacto@bahiadelcaribe.example']);
    expect(by('TELEFONO')).toEqual(['315 482 7731']);
    expect(by('DIRECCION')).toEqual(['Calle 32 No. 8-45, Barrio Getsemaní', 'Carrera 3 No. 18-27']);
    expect(by('CUENTA')).toEqual(['0912-345678-12']);
    expect(by('PLACA')).toEqual(['ABC 123']);
    expect(ents.find((e) => e.type === 'FECHA').enabled).toBe(false);
    expect(ents.find((e) => e.type === 'MONTO').enabled).toBe(false);
  });

  it('une variantes automáticas (empresa sin sufijo y apellido suelto)', async () => {
    const doc = await openDocx(await buildDocx(SAMPLE_PARAGRAPHS));
    const ents = buildEntities(doc.paragraphs);
    expect(ents.find((e) => e.type === 'EMPRESA').aliases).toEqual(['Inversiones Bahía del Caribe']);
    expect(ents.find((e) => e.value.startsWith('Carlos')).aliases).toEqual(['Mendoza']);
  });

  it('busca sin distinguir tildes ni mayúsculas y respeta límites de palabra', () => {
    const found = findOccurrences('Perez y PÉREZ, no Perezoso', [{ id: 'a', value: 'pérez' }]);
    expect(found.map((o) => [o.start, o.end])).toEqual([[0, 5], [8, 13]]);
    expect(detect('Llamar al 315 482 7731').map((d) => d.type)).toEqual(['TELEFONO']);
  });
});

describe('exportar y restaurar Word', () => {
  it('anonimiza a través de varios runs y restaura al original', async () => {
    const buffer = await buildDocx(SAMPLE_PARAGRAPHS);
    const doc = await openDocx(buffer);
    const ents = buildEntities(doc.paragraphs);
    const { blob, count } = await exportAnonymized(buffer, ents, new Set());
    const anon = await textsOf(blob);
    expect(count).toBeGreaterThan(15);
    expect(anon.join('\n')).not.toMatch(/Mendoza|Ortega|901\.234|1\.047|cmendoza|315 482/);
    expect(anon[2]).toContain('representada legalmente por [PERSONA_1]');
    expect(anon[4]).toContain('a nombre de [EMPRESA_1].');

    const dict = buildDictionary(ents);
    const restored = await restoreDocx(await blob.arrayBuffer(), dict);
    const back = await textsOf(restored.blob);
    const original = doc.paragraphs.map((p) => p.text);
    expect(back[2]).toBe(original[2]);
    expect(back[5]).toBe(original[5]);
    expect(back[4]).toContain('Inversiones Bahía del Caribe S.A.S.');
    expect(back[4]).not.toContain('S.A.S..');
    expect(restored.unknown).toEqual([]);
  });

  it('respeta lo desactivado y las exclusiones por aparición', async () => {
    const buffer = await buildDocx(SAMPLE_PARAGRAPHS);
    const doc = await openDocx(buffer);
    let ents = buildEntities(doc.paragraphs);
    ents = setCategoryEnabled(ents, 'CORREO', false);
    const analysis = analyze(doc.paragraphs, ents, new Set());
    const firstPerson = analysis.occurrences.flat().find((o) => ents.find((e) => e.id === o.id).value.startsWith('Carlos'));
    const { blob } = await exportAnonymized(buffer, ents, new Set([firstPerson.key]));
    const text = (await textsOf(blob)).join('\n');
    expect(text).toContain('cmendoza@example.com');
    expect(text).toContain('Carlos Andrés Mendoza Ríos');
    expect(text).toContain('[PERSONA_2]');
  });

  it('una aparición excluida no se traga a su vecina al unir tramos', () => {
    const paragraphs = [{ text: 'Fidel castro firmó.', index: 0 }];
    const base = [createEntity([], 'PERSONA', 'Fidel', true)];
    const ents = addAlias(base, base[0].id, 'castro');
    const a = analyze(paragraphs, ents, new Set(['0:0']));
    expect(a.occurrences[0].map((o) => [o.start, o.end, o.replaced])).toEqual([[0, 5, false], [6, 12, true]]);
    const b = analyze(paragraphs, ents, new Set());
    expect(b.occurrences[0].map((o) => [o.start, o.end, o.replaced])).toEqual([[0, 12, true]]);
  });

  it('procesa encabezados y borra el autor del archivo', async () => {
    const zip = await JSZip.loadAsync(await buildDocx(SAMPLE_PARAGRAPHS));
    zip.file('word/header1.xml', '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Estudio Gómez y Asociados S.A.S. · Tel: 605 664 1234</w:t></w:r></w:p></w:hdr>');
    zip.file('docProps/core.xml', '<cp:coreProperties xmlns:cp="a" xmlns:dc="b"><dc:creator>Marta Gómez</dc:creator><cp:lastModifiedBy>Marta</cp:lastModifiedBy></cp:coreProperties>');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const doc = await openDocx(buffer);
    const ents = buildEntities(doc.paragraphs);
    const { blob } = await exportAnonymized(buffer, ents, new Set());
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const header = await out.file('word/header1.xml').async('string');
    expect(header).toMatch(/\[EMPRESA_\d\] · Tel: \[TELEFONO_\d\]/);
    expect(await out.file('docProps/core.xml').async('string')).not.toMatch(/Marta/);
  });
});

describe('diccionario y texto', () => {
  it('guarda y lee LLAVE: VALOR en JSON y en texto', async () => {
    const doc = await openDocx(await buildDocx(SAMPLE_PARAGRAPHS));
    const dict = buildDictionary(buildEntities(doc.paragraphs));
    expect(parseDictionary(JSON.stringify(dict))).toEqual(dict);
    expect(parseDictionary(dictionaryToText(dict))).toEqual(dict);
    expect(() => parseDictionary('hola')).toThrow();
  });

  it('restaura texto pegado e informa etiquetas desconocidas', () => {
    const dict = { '[PERSONA_1]': 'Ana Gómez', '[EMPRESA_1]': 'Acme S.A.S.' };
    const result = restoreText('Paga [PERSONA_1] a [EMPRESA_1]. Ver [persona_1] y [PERSONA_9].', dict);
    expect(result.text).toBe('Paga Ana Gómez a Acme S.A.S. Ver Ana Gómez y [PERSONA_9].');
    expect(result.unknown).toEqual(['[PERSONA_9]']);
    expect(result.counts['[PERSONA_1]']).toBe(2);
  });
});

describe('operaciones de entidades (inmutables)', () => {
  it('agrega valores manuales, une variantes y valida etiquetas', async () => {
    const doc = await openDocx(await buildDocx(SAMPLE_PARAGRAPHS));
    const base = buildEntities(doc.paragraphs);
    const withManual = addValue(base, { text: 'artesanías', type: 'OTRO' });
    expect(base.length + 1).toBe(withManual.length);
    expect(withManual.at(-1)).toMatchObject({ label: 'DATO_1', manual: true, enabled: true });
    const host = base.find((e) => e.type === 'EMPRESA');
    const joined = addValue(base, { text: 'Bahía del Caribe', joinId: host.id });
    expect(joined.find((e) => e.id === host.id).aliases).toContain('Bahía del Caribe');
    expect(base.find((e) => e.id === host.id).aliases).not.toContain('Bahía del Caribe');
    expect(renameLabel(base, host.id, 'arrendador').entities.find((e) => e.id === host.id).label).toBe('ARRENDADOR');
    const person = base.filter((e) => e.type === 'PERSONA');
    expect(renameLabel(base, person[0].id, person[1].label).error).toMatch(/Ya existe/);
    expect(retype(base, person[0].id, 'OTRO').find((e) => e.id === person[0].id).label).toBe('DATO_1');
  });

  it('avisa de partes de un nombre que quedan sueltas y encuentra búsquedas', async () => {
    const paragraphs = [{ text: 'Carlos Andrés Mendoza Ríos firma. Luego Mendoza paga y Carlos responde.' }];
    const ents = buildEntities(paragraphs);
    const analysis = analyze(paragraphs, ents, new Set());
    const suggestions = findSuggestions(paragraphs, ents, analysis);
    expect(suggestions.map((s) => s.token).sort()).toEqual(['Carlos', 'Mendoza']);
    expect(findHits(paragraphs, 'mendoza').list).toHaveLength(2);
  });
});

describe('tramos contiguos de una misma entidad', () => {
  it('une «Fidel castro» (valor + variante) en una sola etiqueta, en cualquier orden', async () => {
    const [base] = [createEntity([], 'PERSONA', 'Fidel', true)];
    const ents = addAlias([base], base.id, 'castro');
    const paragraphs = [{ text: 'Firmó Fidel castro y luego castro Fidel, no castro.' }];
    const analysis = analyze(paragraphs, ents, new Set());
    expect(analysis.occurrences[0].map((o) => paragraphs[0].text.slice(o.start, o.end)))
      .toEqual(['Fidel castro', 'castro Fidel', 'castro']);
    const buffer = await buildDocx(['Firmó Fidel castro hoy.']);
    const { blob } = await exportAnonymized(buffer, ents, new Set());
    expect(await textsOf(blob)).toContain('Firmó [PERSONA_1] hoy.');
  });
});

describe('variantes por aparición', () => {
  const DEMO = ['Firmó fidel Castro el contrato.', 'Testigo: FIDEL castro. Pagó Fidel castro', 'y luego castro se fue.'];
  const fidel = () => {
    const base = createEntity([], 'PERSONA', 'Fidel', true);
    return addAlias([base], base.id, 'castro');
  };

  it('ida y vuelta: el Word restaurado repite el texto exacto de cada aparición', async () => {
    const ents = fidel();
    const buffer = await buildDocx(DEMO);
    const doc = await openDocx(buffer);
    const analysis = analyze(doc.paragraphs, ents, new Set());
    const sources = collectSources(doc.paragraphs.map((p) => p.text), analysis.occurrences);
    expect(sources[ents[0].id]).toEqual(['fidel Castro', 'FIDEL castro', 'Fidel castro', 'castro']);
    const dict = buildDictionary(ents, analysis.usedIds, sources);
    expect(Object.keys(dict)).toEqual(['[PERSONA_1]']);
    const loaded = parseDictionary(dictionaryJson(dict));
    expect(dictionaryVariants(loaded)).toEqual({ '[PERSONA_1]': ['fidel Castro', 'FIDEL castro', 'Fidel castro', 'castro'] });
    expect(Object.keys(loaded)).toEqual(['[PERSONA_1]']);

    const { blob } = await exportAnonymized(buffer, ents, new Set());
    const restored = await restoreDocx(await blob.arrayBuffer(), loaded);
    expect(await textsOf(restored.blob)).toEqual(DEMO);
    const anonText = (await textsOf(blob)).join('\n');
    expect(restoreText(anonText, loaded).text).toBe(DEMO.join('\n'));
  });

  it('el expediente guarda las mismas variantes y restaura su texto', () => {
    const ents = fidel();
    const applied = anonymizeTexts(DEMO, ents);
    const dict = parseDictionary(dictionaryJson(buildDictionary(ents, new Set(applied.usedIds), applied.sources)));
    expect(restoreText(applied.texts.join('\n'), dict).text).toBe(DEMO.join('\n'));
  });

  it('sin variantes distintas del valor no agrega la llave', () => {
    const ents = [createEntity([], 'PERSONA', 'Ana Gómez', true)];
    const dict = buildDictionary(ents, null, { [ents[0].id]: ['Ana Gómez', 'Ana Gómez'] });
    expect(dictionaryJson(dict)).not.toContain('__variants__');
  });

  it('un diccionario de antes (sin variantes) restaura igual que siempre', () => {
    const old = parseDictionary('{\n  "[PERSONA_1]": "Fidel castro",\n  "[CEDULA_1]": "45.521.884"\n}');
    expect(dictionaryVariants(old)).toEqual({});
    expect(restoreText('[PERSONA_1] ([CEDULA_1]) y [PERSONA_1].', old).text).toBe('Fidel castro (45.521.884) y Fidel castro.');
  });

  it('si el número de apariciones no cuadra, todas vuelven al valor principal', () => {
    const dict = parseDictionary(JSON.stringify({ '[PERSONA_1]': 'Fidel', __variants__: { '[PERSONA_1]': ['Fidel castro', 'castro'] } }));
    expect(restoreText('[PERSONA_1] y [PERSONA_1]', dict).text).toBe('Fidel castro y castro');
    expect(restoreText('[PERSONA_1], [PERSONA_1] y [PERSONA_1]', dict).text).toBe('Fidel, Fidel y Fidel');
  });

  it('descarta variantes mal formadas o de etiquetas que no existen', () => {
    const dict = parseDictionary(JSON.stringify({
      '[PERSONA_1]': 'Ana', __variants__: { '[PERSONA_1]': ['ana', 3], '[PERSONA_9]': ['x'] }
    }));
    expect(dictionaryVariants(dict)).toEqual({});
    expect(() => parseDictionary(JSON.stringify({ __variants__: { '[PERSONA_1]': ['x'] } }))).toThrow();
  });
});
