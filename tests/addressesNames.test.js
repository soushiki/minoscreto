import { describe, it, expect } from 'vitest';
import { detect, buildEntities, findOccurrences, toNeedles } from '../src/model/index.js';

const of = (text, type) => detect(text).filter((d) => d.type === type).map((d) => text.slice(d.start, d.end));
const addresses = (text) => of(text, 'DIRECCION');
const people = (text) => detect(text).filter((d) => d.type === 'PERSONA').map((d) => [text.slice(d.start, d.end), d.weak ? 'débil' : 'fuerte']);

describe('direcciones colombianas', () => {
  it.each([
    ['Reside en la Calle 45 # 12-30 de esta ciudad.', 'Calle 45 # 12-30'],
    ['Domicilio: Cl 45 #12-30.', 'Cl 45 #12-30'],
    ['Domicilio: Cll. 45 No. 12 - 30.', 'Cll. 45 No. 12 - 30'],
    ['Notificaciones en la Cra. 7 N° 71-21, piso 4.', 'Cra. 7 N° 71-21, piso 4'],
    ['Oficina en Kr 15A # 93B-10.', 'Kr 15A # 93B-10'],
    ['Vive en la Carrera 15 Bis # 93-20 Sur.', 'Carrera 15 Bis # 93-20 Sur'],
    ['Sede en la Av. Carrera 68 N° 24 - 10.', 'Av. Carrera 68 N° 24 - 10'],
    ['Sede en la Avenida Calle 26 # 59-51 Torre 3 Oficina 502.', 'Avenida Calle 26 # 59-51 Torre 3 Oficina 502'],
    ['Queda en la Ak 30 # 45 12.', 'Ak 30 # 45 12'],
    ['Entrega en la Dg 15 Bis A #45-20, Barrio La Floresta, de Bogotá.', 'Dg 15 Bis A #45-20, Barrio La Floresta'],
    ['Entrega en la Tv 3 No. 18-27 Apto 502 Interior 2.', 'Tv 3 No. 18-27 Apto 502 Interior 2'],
    ['Local en la Transversal 93 # 53-48 Local 12B.', 'Transversal 93 # 53-48 Local 12B'],
    ['Bodega en la Autopista Norte # 150-20? No: Autopista 80 # 150-20.', 'Autopista 80 # 150-20'],
    ['DOMICILIADO EN LA CARRERA 43A No. 1-50 APTO 1203, BARRIO EL POBLADO.', 'CARRERA 43A No. 1-50 APTO 1203, BARRIO EL POBLADO'],
    ['domiciliado en la calle 10 # 5-23 barrio el prado de esta ciudad', 'calle 10 # 5-23 barrio el prado'],
    ['Lote ubicado en la Mz 4 Casa 12 de la urbanización.', 'Mz 4 Casa 12'],
    ['Predio en la Manzana C Lote 8, Conjunto Los Almendros.', 'Manzana C Lote 8, Conjunto Los Almendros'],
    ['La finca queda en el Km 5 vía La Calera, vereda El Salitre.', 'Km 5 vía La Calera, vereda El Salitre'],
    ['La bodega queda en el kilómetro 12 de la vía que conduce a Fusagasugá.', 'kilómetro 12 de la vía que conduce a Fusagasugá']
  ])('%s', (text, expected) => {
    expect(addresses(text)).toEqual([expected]);
  });

  it('no confunde con fechas, artículos, montos ni otras cifras', () => {
    for (const text of [
      'Conforme al artículo 12 de la Ley 1564 de 2012, numeral 3.',
      'El pago de 45 cuotas de 12 meses se hará el 12-30 de cada mes.',
      'La calle principal del pueblo es angosta y la carrera de caballos fue el 5 de mayo.',
      'Se registró en el folio 45 # 12 del libro.',
      'Ver la cláusula 7 No. 3 del contrato.'
    ]) {
      expect(addresses(text), text).toEqual([]);
    }
  });

  it('no se traga el texto que sigue', () => {
    expect(addresses('Vive en la Calle 32 No. 8-45, Barrio Getsemaní, Cartagena, y trabaja en la Carrera 3 No. 18-27 desde 2020.'))
      .toEqual(['Calle 32 No. 8-45, Barrio Getsemaní', 'Carrera 3 No. 18-27']);
    expect(addresses('Calle 10 # 5-23 Barrio San Diego donde funciona el negocio.')).toEqual(['Calle 10 # 5-23 Barrio San Diego']);
    expect(addresses('Calle 32 No. 8-45 y la Carrera 43A No. 1-50 i l ! ;')).toEqual(['Calle 32 No. 8-45', 'Carrera 43A No. 1-50']);
    expect(addresses('Bodega en la Calle 13 # 68-40B.')).toEqual(['Calle 13 # 68-40B']);
  });
});

describe('nombres que no van en «Tipo Título»', () => {
  it('en MAYÚSCULAS, como en muchos documentos legales', () => {
    expect(people('Comparece el señor JUAN CARLOS PÉREZ GÓMEZ, identificado con C.C. 80.123.456.')).toEqual([['JUAN CARLOS PÉREZ GÓMEZ', 'fuerte']]);
    expect(people('DEMANDANTE: MARÍA FERNANDA QUINTERO SALAS')).toEqual([['MARÍA FERNANDA QUINTERO SALAS', 'fuerte']]);
    expect(people('A favor de JORGE ELIÉCER GAITÁN ROJAS se libra mandamiento de pago.')).toEqual([['JORGE ELIÉCER GAITÁN ROJAS', 'fuerte']]);
  });

  it('en minúsculas y mezclado, con o sin tildes', () => {
    expect(people('el acta la firmó juan carlos perez gomez como testigo.')).toEqual([['juan carlos perez gomez', 'fuerte']]);
    expect(people('Recibido por: Juan carlos perez.')).toEqual([['Juan carlos perez', 'fuerte']]);
    expect(people('la apoderada sandra milena ruiz ospina allegó memorial.')).toEqual([['sandra milena ruiz ospina', 'fuerte']]);
  });

  it('sin apellido conocido ni pista, en minúscula, solo se sugiere', () => {
    expect(people('el mensaje decía que juan carlos llegaría tarde.')).toEqual([['juan carlos', 'débil']]);
    expect(people('la luz rojas del semáforo estaba apagada.')).toEqual([['luz rojas', 'débil']]);
  });

  it('no toma títulos en MAYÚSCULAS ni palabras comunes', () => {
    for (const text of [
      'CONSIDERANDOS', 'RESUELVE:', 'CONTRATO DE ARRENDAMIENTO DE LOCAL COMERCIAL', 'JUZGADO TERCERO CIVIL DEL CIRCUITO DE BOGOTÁ',
      'PRIMERA. OBJETO. EL ARRENDADOR entrega el inmueble.', 'la rosa del jardín y la luz de la tarde', 'LUZ VERDE PARA EL PROYECTO'
    ]) {
      expect(people(text), text).toEqual([]);
    }
  });

  it('el mismo nombre en mayúsculas, minúsculas y tipo título comparte una etiqueta', () => {
    const texts = [
      'DEMANDANTE: CARLOS ANDRÉS MENDOZA RÍOS',
      'El señor Carlos Andrés Mendoza Ríos presentó la demanda.',
      'notificado carlos andres mendoza rios por correo.'
    ];
    const ents = buildEntities(texts.map((text) => ({ text })));
    const persons = ents.filter((e) => e.type === 'PERSONA');
    expect(persons).toHaveLength(1);
    const needles = toNeedles(ents);
    expect(texts.every((t) => findOccurrences(t, needles).length === 1)).toBe(true);
  });

  it('los nombres en minúscula sin pista quedan apagados, para revisar', () => {
    const ents = buildEntities([{ text: 'el mensaje decía que juan carlos llegaría tarde.' }]);
    expect(ents.find((e) => e.type === 'PERSONA')).toMatchObject({ value: 'juan carlos', weak: true, enabled: false });
  });
});
