# Minoscreto (React)

Anonimiza documentos Word antes de usar IA y restaura los nombres después. Todo corre en el navegador.

## Comandos
- `npm install`
- `npm run dev` – desarrollo
- `npm test` – pruebas (Vitest)
- `npm run build` – genera `dist/index.html`, un único archivo autocontenido

## Estructura (MVVM)
- `src/model/` – lógica pura sin React: detección, entidades, análisis, diccionario y manejo de .docx (`docx/`).
- `src/viewmodels/` – hooks con el estado y las acciones: `useAnonymizer`, `useRestorer`, reducer en `anonymizerState.js`, descargas y avisos.
- `src/views/` y `src/components/` – componentes de presentación; solo reciben el view-model por props.
- `src/styles/` – CSS por área. `tests/` – pruebas del modelo y de la app.

## Modo expediente (PDF largo → texto anonimizado para la IA)
Pestaña **Expediente PDF**. Lee la capa de texto de un PDF ya pasado por OCR (por ejemplo, en Acrobat) con pdf.js, reconstruye los párrafos con su folio, anonimiza con la misma detección y exporta texto: un `.md` con marcas `[Folio N]` o un ZIP con partes («Parte X de N · folios A–B» + instrucción para la IA) y el diccionario aparte en `NO-SUBIR/`.
- Lógica pura en `src/model/expediente/` (párrafos, reducción, corrección 0/1 del OCR, división, exportación, variantes de OCR). `pdfjs.js` es lo único que toca pdf.js.
- Estado en `src/viewmodels/useExpediente.js`; detección y anonimización corren en un Web Worker (`src/workers/`).
- pdf.js y su worker van en línea dentro de `dist/index.html` (sube de ~0,4 MB a ~2,2 MB; ~0,67 MB comprimido) y solo se cargan al abrir un PDF. No hay peticiones de red con el documento.
- Prueba de punta a punta: `python scripts/make-expediente-pdf.py .local/expediente-600.pdf 600` y luego `node scripts/bench-expediente.mjs .local/expediente-600.pdf .local/expediente-600.verdad.json`.
