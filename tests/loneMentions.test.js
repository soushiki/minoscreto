import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { buildEntities } from '../src/model/entities.js';
import { analyze } from '../src/model/analysis.js';
import { setCommonNouns, parseCommonNouns } from '../src/model/lexicon.js';

const list = () => parseCommonNouns(fs.readFileSync('src/model/data/common-nouns.txt', 'utf8'));
const build = (...texts) => {
  const paragraphs = texts.map((text) => ({ text }));
  return { paragraphs, entities: buildEntities(paragraphs) };
};
const person = (entities, value) => entities.find((e) => e.type === 'PERSONA' && e.value === value);
const hasAlias = (e, word) => e.aliases.some((a) => a.toLowerCase() === word.toLowerCase());

describe('menciones sueltas de un nombre completo', () => {
  beforeAll(() => setCommonNouns(list()));
  afterAll(() => setCommonNouns([]));

  it('una palabra segura suelta pasa a variante de la persona', () => {
    const { paragraphs, entities } = build('Ana María Mendoza firmó el contrato.', 'Luego Mendoza declaró ante el juez.');
    const owner = person(entities, 'Ana María Mendoza');
    expect(owner).toBeTruthy();
    expect(hasAlias(owner, 'Mendoza')).toBe(true);
    expect(entities.some((e) => e !== owner && e.value === 'Mendoza')).toBe(false);
    const { replacements } = analyze(paragraphs, entities, new Set());
    expect(replacements).toBeGreaterThanOrEqual(2);
  });

  it('una palabra que es también común queda como etiqueta sin marcar', () => {
    const { entities } = build('Ana Rosa Torres firmó.', 'Torres declaró.', 'Las torres del edificio son altas.');
    const owner = person(entities, 'Ana Rosa Torres');
    expect(hasAlias(owner, 'Torres')).toBe(false);
    const lone = entities.find((e) => e.type === 'PERSONA' && e.value === 'Torres');
    expect(lone).toBeTruthy();
    expect(lone.enabled).toBe(false);
  });

  it('una palabra de dos personas queda como una sola etiqueta sin marcar', () => {
    const { entities } = build('Ana Torres Mendoza firmó.', 'Luis Torres Pérez firmó.', 'Torres dijo que sí.');
    const lones = entities.filter((e) => e.type === 'PERSONA' && e.value === 'Torres');
    expect(lones).toHaveLength(1);
    expect(lones[0].enabled).toBe(false);
    for (const e of entities) expect(hasAlias(e, 'Torres')).toBe(false);
  });

  it('una palabra que solo aparece dentro del nombre completo no añade nada', () => {
    const { entities } = build('Ana María Mendoza firmó.', 'Ana María Mendoza pagó.');
    const owner = person(entities, 'Ana María Mendoza');
    expect(owner.aliases).toEqual([]);
    expect(entities.filter((e) => e.type === 'PERSONA')).toHaveLength(1);
  });

  it('una mención suelta en minúscula no cuenta', () => {
    const { entities } = build('Ana María Mendoza firmó el contrato.', 'Pasamos por la casa de mendoza en la tarde.');
    const owner = person(entities, 'Ana María Mendoza');
    expect(owner.aliases).toEqual([]);
    expect(entities.filter((e) => e.value.toLowerCase() === 'mendoza')).toEqual([]);
  });

  it('una palabra que también es de una empresa no se une', () => {
    const { entities } = build('Mendoza Asociados S.A.S. firmó el contrato.', 'Ana María Mendoza firmó también.', 'Luego Mendoza declaró.');
    expect(entities.some((e) => e.type === 'EMPRESA')).toBe(true);
    const owner = person(entities, 'Ana María Mendoza');
    expect(owner).toBeTruthy();
    expect(hasAlias(owner, 'Mendoza')).toBe(false);
  });
});

describe('menciones sueltas con la lista de comunes vacía', () => {
  beforeAll(() => setCommonNouns([]));
  afterAll(() => setCommonNouns([]));

  it('la palabra queda como etiqueta sin marcar, no como variante', () => {
    const { entities } = build('Ana María Mendoza firmó el contrato.', 'Luego Mendoza declaró ante el juez.');
    const owner = person(entities, 'Ana María Mendoza');
    expect(hasAlias(owner, 'Mendoza')).toBe(false);
    const lone = entities.find((e) => e.type === 'PERSONA' && e.value === 'Mendoza');
    expect(lone).toBeTruthy();
    expect(lone.enabled).toBe(false);
  });
});
