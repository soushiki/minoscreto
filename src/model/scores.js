// Puntaje de confianza de cada detección (idea de Microsoft Presidio): desde THRESHOLD el dato se activa solo;
// por debajo queda como sugerencia, apagado, para que la persona decida.
export const THRESHOLD = 0.5;

export const SCORES = {
  cue: 0.95, // número con su pista: «C.C. No.», «NIT», «cuenta», «tel.», o un correo
  address: 0.85,
  company: 0.85,
  person: 0.85,
  upperName: 0.8,
  caselessName: 0.75,
  nitChecked: 0.85, // NIT sin la palabra «NIT» cuyo dígito de verificación cuadra
  bareNumber: 0.75, // teléfono o radicado por su forma
  layout: 0.8, // número en una columna de tabla con encabezado de ese tipo, o nombre en un bloque de firma
  properNoun: 0.6,
  plate: 0.6,
  weak: 0.35, // señal débil: solo se sugiere
  nitBadCheck: 0.3 // forma de NIT sin la palabra «NIT» y con dígito de verificación que no cuadra
};

const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Dígito de verificación de la DIAN (módulo 11 con los pesos oficiales) para un NIT como «900.123.456-7». */
export function nitCheckDigitOk(value) {
  const m = /^([\d.\s]+)-\s?(\d)$/.exec(value.trim());
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  if (!digits || digits.length > NIT_WEIGHTS.length) return null;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * NIT_WEIGHTS[i];
  const r = sum % 11;
  return (r > 1 ? 11 - r : r) === Number(m[2]);
}
