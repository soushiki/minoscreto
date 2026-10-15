const run = (t, opts = {}) => ({ t, ...opts });

export const SAMPLE_NAME = 'Contrato-de-ejemplo';

export const SAMPLE_PARAGRAPHS = [
  { runs: [run('CONTRATO DE ARRENDAMIENTO DE LOCAL COMERCIAL', { b: 1, sz: 28 })], align: 'center', after: 120 },
  { runs: [run('Contrato No. 2025-00418')], align: 'center', after: 280 },
  {
    runs: [
      run('En la ciudad de Cartagena de Indias, a los 12 de marzo de 2025, se reúnen, de una parte, '),
      run('Inversiones Bahía del Caribe S.A.S.', { b: 1 }),
      run(', sociedad identificada con NIT 901.234.567-8, representada legalmente por Laura Patricia '),
      run('Ortega Jiménez', { i: 1 }),
      run(', mayor de edad, identificada con la cédula de ciudadanía No. 45.521.884 (en adelante, EL ARRENDADOR), y de otra parte, el señor '),
      run('Carlos Andrés Mendoza Ríos', { b: 1 }),
      run(', mayor de edad, identificado con C.C. No. 1.047.382.915, domiciliado en la Calle 32 No. 8-45, Barrio Getsemaní, Cartagena (en adelante, EL ARRENDATARIO), quienes acuerdan celebrar el presente contrato.')
    ]
  },
  'PRIMERA. OBJETO. EL ARRENDADOR entrega a EL ARRENDATARIO, a título de arrendamiento, el local comercial No. 4 del Centro Comercial Plaza Marina, ubicado en la Carrera 3 No. 18-27, Cartagena, destinado exclusivamente a la venta de artesanías.',
  'SEGUNDA. CANON. El canon mensual de arrendamiento es de $4.800.000 (cuatro millones ochocientos mil pesos m/cte), pagaderos dentro de los primeros cinco días de cada mes mediante consignación en la cuenta de ahorros Bancolombia No. 0912-345678-12 a nombre de Inversiones Bahía del Caribe.',
  'TERCERA. DURACIÓN. El contrato tendrá una duración de doce (12) meses, contados a partir del 1 de abril de 2025. Vencido ese plazo, se prorrogará por periodos iguales si ninguna de las partes manifiesta lo contrario con tres meses de antelación.',
  'CUARTA. NOTIFICACIONES. EL ARRENDATARIO recibirá comunicaciones en cmendoza@example.com y en el celular 315 482 7731. EL ARRENDADOR las recibirá en contacto@bahiadelcaribe.example.',
  'QUINTA. PARQUEADERO. EL ARRENDATARIO podrá usar un cupo de parqueadero para el vehículo de placas ABC 123, de su propiedad.',
  'SEXTA. MORA. En caso de mora en el pago del canon, el señor Mendoza reconocerá intereses a la tasa máxima legal permitida, sin perjuicio de las demás acciones que correspondan al ARRENDADOR.',
  { runs: [run('Para constancia, las partes firman en dos ejemplares del mismo tenor, en Cartagena, el 12 de marzo de 2025.')], after: 480 },
  { runs: [run('______________________________')], align: 'center', after: 0 },
  { runs: [run('Laura Patricia '), run('Ortega Jiménez', { b: 1 })], align: 'center', after: 0 },
  { runs: [run('C.C. 45.521.884 · Representante legal de Inversiones Bahía del Caribe S.A.S.')], align: 'center', after: 360 },
  { runs: [run('______________________________')], align: 'center', after: 0 },
  { runs: [run('Carlos Andrés Mendoza Ríos', { b: 1 })], align: 'center', after: 0 },
  { runs: [run('C.C. 1.047.382.915')], align: 'center' }
];
