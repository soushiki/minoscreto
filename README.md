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
