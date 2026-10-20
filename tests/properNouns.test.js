import { describe, it, expect } from 'vitest';
import {
  buildEntities, analyze, buildDocx, openDocx, SAMPLE_PARAGRAPHS, findOccurrences, toNeedles
} from '../src/model/index.js';

const entitiesOf = (texts) => buildEntities(texts.map((text) => ({ text })));
const names = (ents, type = 'NOMBRE') => ents.filter((e) => e.type === type && !e.weak).map((e) => e.value);
const weak = (ents) => ents.filter((e) => e.weak).map((e) => e.value);
const anonymize = (text, ents) => {
  let out = '';
  let pos = 0;
  const byId = new Map(ents.map((e) => [e.id, e]));
  for (const o of findOccurrences(text, toNeedles(ents))) {
    if (!byId.get(o.id).enabled) continue;
    out += text.slice(pos, o.start) + `[${byId.get(o.id).label}]`;
    pos = o.end;
  }
  return out + text.slice(pos);
};

describe('nombres propios: lo que sí se detecta', () => {
  it('proyectos, inmuebles con nombre, fincas, conjuntos, marcas y plataformas', () => {
    const ents = entitiesOf([
      'En el marco del proyecto Altamira, la constructora inició obras en el lote ubicado en la vereda El Retiro del municipio de La Calera.',
      'Las partes celebran el contrato sobre el inmueble denominado «Mirador del Río», ubicado en la Finca La Esperanza.',
      'El vendedor transfiere el apartamento 502 de la Torre 3 del Conjunto Residencial Los Pinos.',
      'La aplicación Pagafácil y la plataforma conocida como TransaNet procesan los pagos.',
      'Los productos de la marca Chocolisto se venden en tiendas de barrio.'
    ]);
    expect(names(ents).sort()).toEqual([
      'Altamira', 'Chocolisto', 'Conjunto Residencial Los Pinos', 'El Retiro', 'Finca La Esperanza', 'La Calera', 'Mirador del Río', 'Pagafácil', 'TransaNet'
    ]);
    expect(ents.filter((e) => e.type === 'NOMBRE').every((e) => e.enabled)).toBe(true);
  });

  it('un mismo nombre tiene una sola etiqueta, con y sin la palabra «Proyecto»', () => {
    const texts = [
      'El Proyecto Altamira cuenta con licencia de construcción.',
      'La fiducia del proyecto Altamira recibe los aportes; Altamira será entregado en 2026.'
    ];
    const ents = entitiesOf(texts);
    const altamira = ents.filter((e) => e.type === 'NOMBRE');
    expect(altamira).toHaveLength(1);
    expect(altamira[0]).toMatchObject({ value: 'Proyecto Altamira', aliases: ['Altamira'], enabled: true });
    const out = texts.map((t) => anonymize(t, ents)).join(' ');
    expect(out).not.toMatch(/Altamira/);
    expect(out.match(/\[NOMBRE_\d+\]/g).every((l) => l === '[NOMBRE_1]')).toBe(true);
  });

  it('nombres a mitad de frase que no aparecen en minúscula en el documento', () => {
    const ents = entitiesOf([
      'La obra la ejecuta el consorcio con apoyo de Ingetec Andina, que supervisa el diseño.',
      'Ingetec Andina entregó los planos el mes pasado.'
    ]);
    expect(names(ents)).toEqual(['Ingetec Andina']);
  });

  it('países y ciudades van aparte y apagados por defecto', () => {
    const ents = entitiesOf(['La plataforma opera en Colombia y en Panamá, con oficinas en Cartagena de Indias y Medellín.']);
    expect(names(ents, 'LUGAR').sort()).toEqual(['Cartagena de Indias', 'Colombia', 'Medellín', 'Panamá']);
    expect(ents.filter((e) => e.type === 'LUGAR').every((e) => !e.enabled)).toBe(true);
  });
});

describe('nombres propios: lo que no se debe detectar', () => {
  it('instituciones, normas, términos definidos del contrato, fechas, títulos en mayúsculas y números romanos', () => {
    const ents = entitiesOf([
      'Conforme al artículo 167 del Código General del Proceso, el Juzgado Tercero Civil del Circuito decidirá.',
      'La Corte Constitucional, en Sentencia T-406 de 1992, señaló que la Ley 1564 de 2012 aplica.',
      'El Inmueble objeto del Contrato será entregado a la Parte Compradora el lunes 3 de marzo.',
      'CLÁUSULA PRIMERA. OBJETO. EL VENDEDOR transfiere a título de venta el inmueble.',
      'Mediante auto del 5 de mayo, el despacho ordenó oficiar a la Superintendencia de Sociedades y a la Cámara de Comercio.',
      'CAPÍTULO III. Para constancia se firma. Sin embargo, el inmueble se entrega. Durante la diligencia se escuchó a los testigos.',
      'Se reconocen intereses a la tasa máxima legal conforme a la Constitución Política y al Estatuto Tributario.'
    ]);
    expect(ents.filter((e) => e.type === 'NOMBRE')).toEqual([]);
  });

  it('palabras comunes al inicio de frase no se sugieren si aparecen en minúscula en el documento', () => {
    const ents = entitiesOf([
      'Vencido el plazo, el arrendatario entrega. Respecto del canon, se pagará el día cinco.',
      'El plazo vencido se prorroga; respecto de la mora, se aplica la tasa legal.'
    ]);
    expect(weak(ents)).toEqual([]);
    expect(names(ents)).toEqual([]);
  });

  it('no duplica lo que ya es una persona o una empresa', () => {
    const ents = entitiesOf([
      'Inversiones Bahía del Caribe S.A.S. arrienda el local. El pago se consigna a nombre de Inversiones Bahía del Caribe.',
      'Firma Carlos Andrés Mendoza Ríos. Luego Mendoza paga.'
    ]);
    expect(ents.filter((e) => e.type === 'NOMBRE')).toEqual([]);
    expect(ents.find((e) => e.type === 'EMPRESA').aliases).toEqual(['Inversiones Bahía del Caribe']);
  });
});

describe('nombres propios: señales débiles', () => {
  it('se proponen apagados: palabra desconocida al inicio de frase o una sola vez a mitad de frase', () => {
    const ents = entitiesOf([
      'Bancolombia informó el saldo de la cuenta.',
      'El pago se hizo por Nequi una vez.'
    ]);
    expect(weak(ents).sort()).toEqual(['Bancolombia', 'Nequi']);
    expect(ents.filter((e) => e.weak).every((e) => !e.enabled)).toBe(true);
  });

  it('una señal débil se confirma si el mismo nombre aparece luego con señal fuerte', () => {
    const ents = entitiesOf([
      'Altavista entregó el informe.',
      'Los planos del proyecto Altavista están aprobados.'
    ]);
    expect(ents.filter((e) => e.type === 'NOMBRE')).toHaveLength(1);
    expect(ents.find((e) => e.type === 'NOMBRE')).toMatchObject({ enabled: true });
    expect(ents.find((e) => e.type === 'NOMBRE').weak).toBeUndefined();
  });
});

describe('contrato de ejemplo', () => {
  it('encuentra el centro comercial y deja el resto como estaba', async () => {
    const doc = await openDocx(await buildDocx(SAMPLE_PARAGRAPHS));
    const ents = buildEntities(doc.paragraphs);
    expect(names(ents)).toEqual(['Centro Comercial Plaza Marina']);
    expect(ents.find((e) => e.type === 'NOMBRE').aliases).toEqual(['Plaza Marina']);
    expect(names(ents, 'LUGAR')).toEqual(['Cartagena de Indias', 'Cartagena']);
    expect(weak(ents)).toEqual(['Bancolombia']);
    const analysis = analyze(doc.paragraphs, ents, new Set());
    expect(analysis.replacements).toBeGreaterThan(0);
  });
});

describe('nombres propios: menos falsas alarmas en documentos legales y formularios', () => {
  const flagged = (texts) => buildEntities(texts.map((text) => ({ text }))).filter((e) => e.type === 'NOMBRE').map((e) => e.value);

  it('no marca instituciones, normas ni publicaciones', () => {
    expect(flagged([
      'El Sistema General de Seguridad Social Integral cubre a los afiliados del Sistema General de Pensiones.',
      'Según el Pacto Internacional de Derechos Civiles y la Convención Americana sobre Derechos Humanos, y el Partido Verde.',
      'La Administradora de Fondos de Pensiones respondió, y la Facultad de Derecho intervino.'
    ])).toEqual([]);
  });

  it('no marca palabras comunes con mayúscula ni rótulos de formularios', () => {
    expect(flagged([
      'Intervención de la Corporación. La Corporación decidió sobre las Garantías y las Garantías adicionales.',
      'Tipo Persona: Natural. Total Afiliados: 1. Valor Cotización: 300. Prórroga: No Aplica.',
      'Haga clic aquí. Haga clic para escribir.'
    ])).toEqual([]);
  });

  it('sigue marcando nombres propios de verdad', () => {
    expect(names(entitiesOf(['El proyecto Altamira avanza.', 'Se pagó por Davivienda y luego por Davivienda otra vez.']))).toEqual(['Altamira', 'Davivienda']);
  });

  it('un cargo antes del nombre no impide ocultar a la persona', () => {
    const texts = ['hace uso de la palabra la Senadora Ximena Rocío Albornoz Pardo: gracias.'];
    const ents = buildEntities(texts.map((text) => ({ text })));
    const needles = toNeedles(ents.filter((e) => e.enabled));
    const covered = findOccurrences(texts[0], needles).map((o) => texts[0].slice(o.start, o.end)).join(' ');
    expect(covered).toContain('Ximena Rocío Albornoz Pardo');
  });
});
