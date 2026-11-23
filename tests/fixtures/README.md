# Fixtures PDF sintéticas

Todos los datos son inventados. Se regeneran con `python scripts/make-expediente-pdf.py --fixtures`
(PyMuPDF; la de Chrome necesita Chrome instalado).

| Archivo | Cómo se hizo | Contraseña |
|---|---|---|
| `contrasena_usuario_sintetico.pdf` | PyMuPDF, 6 líneas de un expediente, AES-256 con contraseña de usuario y de propietario | usuario `minoscreto-prueba`, propietario `propietario-prueba` |
| `solo_propietario_sintetico.pdf` | Mismo texto, AES-256 solo con contraseña de propietario (restricciones, sin contraseña de apertura); pdf.js lo abre sin preguntar | propietario `propietario-prueba` (abre sin contraseña) |
| `etiquetas_fin_de_linea_sintetico.pdf` | PyMuPDF, respuesta anonimizada con etiquetas cortadas al final de línea (`[EMPRE-`/`SA_1]`, `[PERSONA_`/`2]`, `[DIRECCION_1`/`]`) y un texto normal entre corchetes con salto que no es etiqueta. Las claves del diccionario están en `etiquetas_fin_de_linea_sintetico.json` | ninguna |
| `chrome_guardar_como_sintetico.pdf` | HTML de una respuesta anonimizada en columna angosta, impreso con Chrome headless (`--print-to-pdf`, igual que "Guardar como PDF"); Chrome cortó `[DIRECCION_`/`1]` en la tabla | ninguna |
| `tabla_sintetico.pdf` | pdf-lib (Helvetica), 2 páginas: título con valores dentro de la frase y tabla de 7 columnas con bordes, un objeto de texto por celda (como un reporte de semanas cotizadas). Valores en `tabla_sintetico.json` | ninguna |
| `sucio_sintetico.pdf` | PyMuPDF, 2 páginas, con un valor sembrado (`Laura Patricia Ortega Jiménez`) en Info, XMP, nota y texto libre, campo de formulario, índice, adjunto, JavaScript (Names, OpenAction, AA), StructTreeRoot y PieceInfo; flujos de objetos y una revisión anterior (guardado incremental). Para la limpieza S7 | ninguna |
| `prosa_sintetico.pdf` | pdf-lib (Helvetica), 6 líneas de un expediente, un objeto de texto por línea con los valores en medio (como Word). Mismos valores de `tabla_sintetico.json` | ninguna |
| `valor_partido_sintetico.pdf` | pdf-lib (Helvetica), una página, hecha una vez: el nombre `Ana María` / `Pérez Gómez` partido en dos líneas; ahora lo cambia el motor (T12b) | ninguna |
| `valor_entre_folios_sintetico.pdf` | pdf-lib (Helvetica), dos páginas, hecha una vez: `Ana María` al final de la página 1 y `Pérez Gómez` al inicio de la 2; el motor borra cada trozo (T12c: el de la página 1 con etiqueta, el de la 2 sin ella) | ninguna |
| `valor_tres_folios_sintetico.pdf` | pdf-lib (Helvetica), tres páginas, hecha una vez, con un encabezado repetido en cada una: `Ana` al final de la 1, solo `María` en la 2 y `Pérez Gómez` al inicio de la 3; el valor cruza dos saltos, el motor no lo cambia y la verificación lo rechaza (missed-value, R4) | ninguna |
| `ocr_cero_sintetico.pdf` | pdf-lib (Helvetica), una página, hecha una vez: `Luis Fernando Díaz R0jas` con un cero en vez de la «o» (error de OCR); la compuerta lee `Rojas` (fixDigitConfusions) y el motor también debe cambiarlo | ninguna |
| `respuesta_ia_sintetico.pdf` | pdf-lib (Helvetica), hecha una vez: respuesta de una IA de 2 páginas con etiquetas en medio de las líneas (una pegada a un punto, una repetida en las dos páginas), una tabla de 3 columnas con una etiqueta por celda, una línea en gris oscuro y un `[PERSONA_N]` genérico que no está en el diccionario. Diccionario en `respuesta_ia_sintetico.json`. Para restaurar con diseño (T13) | ninguna |

Pendiente (las hace el usuario con sus cuentas): exportaciones a PDF de ChatGPT, Claude y Gemini de una respuesta
sintética, con nombre `<ia>_exportado_sintetico.pdf`.
