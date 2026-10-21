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

describe('nombres en MAYÚSCULAS con nombres o apellidos menos comunes', () => {
  it('con dos palabras de nombre conocidas, aunque el resto no esté en las listas', () => {
    expect(people('Entre los suscritos, YOLIMA ESTHER BRICEÑO CASAS, mayor de edad,')).toEqual([['YOLIMA ESTHER BRICEÑO CASAS', 'fuerte']]);
    expect(people('y por la otra HERNANDO TULIO ZAPATA OBREGÓN, identificado con cédula')).toEqual([['HERNANDO TULIO ZAPATA OBREGÓN', 'fuerte']]);
  });

  it('con un tratamiento o una pista aunque ninguna palabra esté en las listas', () => {
    expect(people('se reunieron la sra. GRISELDA PAMPLONA ORDUZ y el sr. TEÓFILO ACUÑA')).toEqual([['GRISELDA PAMPLONA ORDUZ', 'fuerte'], ['TEÓFILO ACUÑA', 'fuerte']]);
    expect(people('CONTRATISTA: YURANI TATIANA ESCALANTE BOHÓRQUEZ')).toEqual([['YURANI TATIANA ESCALANTE BOHÓRQUEZ', 'fuerte']]);
    expect(people('XIMENO ZAMBRANO ULLOA identificado con C.C. 1.234.567')).toEqual([['XIMENO ZAMBRANO ULLOA', 'fuerte']]);
  });

  it('en bloques de firma, sin tomar el cargo', () => {
    expect(people('Con salvamento de voto HORTENSIA ÁVILA CÁRDENAS Magistrada GONZALO ESTUPIÑÁN RUEDA Magistrado'))
      .toEqual([['HORTENSIA ÁVILA CÁRDENAS', 'fuerte'], ['GONZALO ESTUPIÑÁN RUEDA', 'fuerte']]);
    expect(people('Firma RAMIRO ALFONSO PEÑA LUGO PROFESIONAL UNIVERSITARIO DIRECCIÓN TÉCNICA')).toEqual([['RAMIRO ALFONSO PEÑA LUGO', 'fuerte']]);
  });

  it('no toma encabezados ni frases en MAYÚSCULAS', () => {
    for (const text of [
      'NOMBRE DEL PROYECTO DE INVERSIÓN: IMPLEMENTACIÓN DE LA POLÍTICA PÚBLICA', 'DISPOSICIÓN JURÍDICA Y NORMA JURÍDICA',
      'PRESTACIÓN DE SERVICIOS PROFESIONALES COMO ABOGADA EN LA EMPRESA MUNICIPAL', 'VALOR DIECIOCHO MILLONES DE PESOS',
      'DIRECCIÓN TÉCNICA DE SEGURIDAD', 'CERTIFICADO DE CUMPLIMIENTO E INFORMES DE SUPERVISIÓN'
    ]) {
      expect(people(text), text).toEqual([]);
    }
  });
});

describe('nombres con los apellidos primero', () => {
  it('en listas y formularios en tipo título', () => {
    expect(people('3. Montenegro Ríos Lucía Fernanda')).toEqual([['Montenegro Ríos Lucía Fernanda', 'fuerte']]);
    expect(people('8. Quintana Bastidas Rubén')).toEqual([['Quintana Bastidas Rubén', 'fuerte']]);
  });

  it('en MAYÚSCULAS, como en planillas y certificados', () => {
    expect(people('Nombre completo del Contratista: GALEANO PERDOMO ROSA ELVIRA')).toEqual([['GALEANO PERDOMO ROSA ELVIRA', 'fuerte']]);
    expect(people('1 CC 12345678 TORRES BALLÉN EUDORO 30 0 N')).toEqual([['TORRES BALLÉN EUDORO', 'fuerte']]);
  });

  it('no suma palabras de instituciones o cargos antes del nombre', () => {
    expect(people('El Consejo Superior Teodoro')).toEqual([]);
    expect(people('la Corte Suprema de Justicia María Fernanda Gómez')).toEqual([['María Fernanda Gómez', 'fuerte']]);
    expect(people('PLAZA DE MERCADO CENTRAL')).toEqual([]);
  });
});

describe('otros formatos de cédula y cuenta', () => {
  const found = (text, type) => detect(text).filter((d) => d.type === type).map((d) => text.slice(d.start, d.end));

  it.each([
    ['identificado con cédula de ciudadanía N 1.098.765.432 expedida en Pasto', '1.098.765.432'],
    ['identificada con cédula de ciudadana N°1.098.765.432 actuando', '1.098.765.432'],
    ['identificado con cédula de ciudadanía NO 71,234,567, mayor de edad', '71,234,567'],
    ['Tipo de identificación: CC - No. 71234567 Nombre', '71234567'],
    ['C.C. Nro. 71.234.567 de Ibagué', '71.234.567']
  ])('cédula en «%s»', (text, number) => {
    expect(found(text, 'CEDULA')).toEqual([number]);
  });

  it('cuenta con la palabra en MAYÚSCULAS', () => {
    expect(found('TIPO DE CUENTA: AHORROS N° CUENTA: 004500123456', 'CUENTA')).toEqual(['004500123456']);
  });

  it('no toma montos ni normas como cédulas', () => {
    expect(found('pagó $ 1,250,000 pesos según la Ley N 1150 de 2007', 'CEDULA')).toEqual([]);
  });
});

describe('nombres completos con una palabra en minúscula', () => {
  it.each([
    ['El señor Ernesto hernán Villabona Ruiz firmó el contrato.', 'Ernesto hernán Villabona Ruiz'],
    ['Lo recibió Gloria Patricia ospina Vélez en la oficina.', 'Gloria Patricia ospina Vélez'],
    ['Según Julio César Arango gómez, el pago se hizo.', 'Julio César Arango gómez'],
    ['Comparece Rigoberto albán Restrepo, identificado con C.C. 71.234.567.', 'Rigoberto albán Restrepo'],
    ['La demandante Yuliza marcela Paz Obregón presentó el escrito.', 'Yuliza marcela Paz Obregón'],
    ['Luego Carlos andrés Mendoza ríos pagó la cuota.', 'Carlos andrés Mendoza ríos']
  ])('«%s»', (text, name) => {
    expect(people(text).map(([v]) => v)).toContain(name);
  });

  it('no suma verbos ni palabras comunes en minúscula', () => {
    expect(people('El señor Carlos Pérez pagó la mora el lunes.').map(([v]) => v)).toEqual(['Carlos Pérez']);
    expect(people('Juan Gómez vive en la calle 5 con María Ruiz.').map(([v]) => v)).toEqual(['Juan Gómez', 'María Ruiz']);
    expect(people('Pedro Sánchez firmó y Luis Torres recibió.').map(([v]) => v)).toEqual(['Pedro Sánchez', 'Luis Torres']);
    expect(people('Ana María compró paz y tranquilidad.').map(([v]) => v)).toEqual(['Ana María']);
  });
});
