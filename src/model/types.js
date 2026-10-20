export const TYPES = [
  { id: 'PERSONA', name: 'Personas', single: 'Persona', prefix: 'PERSONA', on: true },
  { id: 'EMPRESA', name: 'Empresas y entidades', single: 'Empresa', prefix: 'EMPRESA', on: true },
  { id: 'CEDULA', name: 'Cédulas y pasaportes', single: 'Cédula', prefix: 'CEDULA', on: true },
  { id: 'NIT', name: 'NIT', single: 'NIT', prefix: 'NIT', on: true },
  { id: 'CORREO', name: 'Correos electrónicos', single: 'Correo', prefix: 'CORREO', on: true },
  { id: 'TELEFONO', name: 'Teléfonos', single: 'Teléfono', prefix: 'TELEFONO', on: true },
  { id: 'DIRECCION', name: 'Direcciones', single: 'Dirección', prefix: 'DIRECCION', on: true },
  { id: 'CUENTA', name: 'Cuentas bancarias', single: 'Cuenta', prefix: 'CUENTA', on: true },
  { id: 'RADICADO', name: 'Radicados y referencias', single: 'Radicado', prefix: 'RADICADO', on: true },
  { id: 'PLACA', name: 'Placas de vehículo', single: 'Placa', prefix: 'PLACA', on: true },
  { id: 'NOMBRE', name: 'Nombres propios', single: 'Nombre propio', prefix: 'NOMBRE', on: true },
  { id: 'LUGAR', name: 'Países y ciudades', single: 'Lugar', prefix: 'LUGAR', on: false },
  { id: 'FECHA', name: 'Fechas', single: 'Fecha', prefix: 'FECHA', on: false },
  { id: 'MONTO', name: 'Montos', single: 'Monto', prefix: 'MONTO', on: false },
  { id: 'OTRO', name: 'Agregados por ti', single: 'Otro dato', prefix: 'DATO', on: true }
];

export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));
