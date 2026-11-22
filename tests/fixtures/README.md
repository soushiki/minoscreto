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
| `valor_partido_sintetico.pdf` | pdf-lib (Helvetica), una página, hecha una vez: el nombre `Ana María` / `Pérez Gómez` partido en dos líneas, para que la verificación final encuentre el valor que no se cambió (missed-value) | ninguna |

Pendiente (las hace el usuario con sus cuentas): exportaciones a PDF de ChatGPT, Claude y Gemini de una respuesta
sintética, con nombre `<ia>_exportado_sintetico.pdf`.
