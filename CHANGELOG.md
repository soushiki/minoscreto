# Changelog

## 0.4.0 — 2026-11-19
### Añadido
- PDF con contraseña: Minoscreto la pide, permite verla con «Mostrar»/«Ocultar» y la usa solo para abrir el archivo en este computador; no se guarda ni se envía.
- Expediente en PDF: el documento protegido se descarga como PDF sin contraseña (`documento-XXXX_protegido.pdf`) junto con su diccionario; en partes, cada parte va en PDF y en texto dentro del .zip.
- Restaurar desde PDF: en «Restaurar nombres» → «Archivo» se sube el PDF anonimizado o el que devolvió la IA, y se descarga un PDF restaurado sin contraseña.
- El PDF restaurado no trae el encabezado para la IA, las notas de etiquetas ni las marcas [Folio N].

### Cambiado
- Lo que se sube a la IA ya no lleva el nombre del archivo: el título es «Documento» y los archivos se llaman `documento-XXXX…`. El diccionario y el .zip guardan el nombre real con el mismo código XXXX, y el archivo restaurado vuelve a llamarse con el nombre real.
- Cabeceras de seguridad en el sitio (política de contenido con hashes).
- En iPhone y iPad el diccionario se descarga con un toque explícito.

### Corregido
- Al subir otro archivo en «Restaurar nombres» ya no se muestra ni se descarga el resultado del anterior.
- Cambiar el diccionario ya no vuelve a pedir la contraseña del PDF.
- El aviso de caracteres que no caben en el PDF ya no lo tapa el mensaje de «guardado».
- Títulos largos o con corchetes ya no dejan el encabezado para la IA en el PDF restaurado.

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
