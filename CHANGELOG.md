# Changelog

## 0.3.0 — 2026-10-24
### Añadido
- Nombres de persona en cualquier combinación de mayúsculas y minúsculas («fidel Castro», «FIDEL castro», «Fidel castro»).
- Tratamiento + nombre en minúscula como una sola persona («Dra. lucía Paz», «el señor fidel Castro», «Firma: ana María Gómez»).
- Una palabra agregada a una etiqueta existente se une a la ocurrencia contigua: una sola etiqueta.
- Cada ocurrencia se restaura con su texto exacto, mayúsculas incluidas (clave oculta `__variants__`; los diccionarios anteriores siguen sirviendo).

### Corregido
- Una ocurrencia excluida ya no absorbe a su vecina al unirse.
- La restauración solo lee claves propias del diccionario (`__proto__`, `toString`).
- Deshacer/rehacer de «agregar a la etiqueta» devuelve exactamente las mismas entidades y salida.

### Límite conocido
- Un nombre en minúscula tras un tratamiento seguido de una ciudad («Firma: juan Bogotá») no se etiqueta.
