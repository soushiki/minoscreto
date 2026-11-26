# Changelog

## 0.5.2 — 2026-11-26
### Corregido
- PDF con diseño: al borrar un dato ya no se abre un hueco blanco en las celdas grises de las tablas; solo se borra el texto.
- PDF con diseño: la revisión final ya no rechaza por error un PDF limpio (un dato corto coincidía por azar con bytes comprimidos).
- PDF con diseño: la etiqueta ya no tapa la letra siguiente (una coma, un paréntesis, otra palabra de la misma línea).
- Detección: palabras comunes de formularios (Ciclo, Ciudadanía, Sim, Post…) ya no se marcan como nombres.
- Detección: se protegen las menciones sueltas de un nombre ya encontrado, las fechas de nacimiento y las direcciones con «ED»; las etiquetas de formulario se unen con su valor.

## 0.5.1 — 2026-11-25
### Corregido
- PDF con diseño en documentos con renglones muy juntos: al borrar un dato ya no se pierde texto del renglón vecino (antes se bajaba el PDF de texto).
- PDF con contraseña: se pide una sola vez, al cargarlo; el PDF con diseño ya no la vuelve a pedir al descargar.

## 0.5.0 — 2026-11-25
### Añadido
- PDF con su diseño original al proteger: cada dato se borra de verdad de la página y su etiqueta queda en su sitio, también los datos partidos entre dos líneas o entre dos páginas.
- Revisión final: el PDF con diseño solo se descarga si no queda ningún dato en él. Si no, se baja el PDF de texto de antes, con un mensaje que explica por qué.
- Motivos del respaldo en texto: páginas escaneadas (dice cuáles), dato que no se pudo cambiar, motor que no cargó o archivo muy grande.
- Aviso de las páginas con imágenes, para que se revisen a mano.
- Del PDF protegido se quitan metadatos, formularios, anotaciones, adjuntos y elementos similares.
- PDF con contraseña: se pide de nuevo al descargar con diseño, y el PDF protegido sale sin contraseña (desde 0.5.1 se pide una sola vez).
- Restaurar también conserva el diseño, tanto con nuestro PDF como con el que devolvió la IA, con el mismo respaldo de texto y su mensaje.
- El motor de PDF (≈3,2 MB) se descarga solo la primera vez que se necesita, desde el mismo sitio; mientras se prepara se ve una barra de carga y el avance por página.
- Vista previa del enlace al compartirlo (Open Graph), `robots.txt`, sitemap e ícono del sitio.
- Conector local para Claude (MCP): anonimiza, lee el texto protegido y restaura desde el disco del usuario; si el PDF tiene contraseña, la pide en una ventana de Windows.

### Cambiado
- Colores con mejor contraste y botones de al menos 44 px.
- Espacio libre en la esquina inferior derecha para el sello de Netlify.
- Tema claro u oscuro según el sistema.
- La ventana de acciones es nativa (Esc la cierra) y los valores se pueden operar con el teclado.
- Mejor ajuste en teléfono, tableta y ventanas bajas.

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
