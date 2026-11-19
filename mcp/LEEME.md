# Minoscreto en Claude Desktop

Con este conector, Claude anonimiza y restaura tus documentos sin pasar por la página web. Todo ocurre en tu computador: Claude solo recibe el texto con etiquetas como `[PERSONA_1]`, nunca el documento original ni el diccionario.

Funciona en **Claude Desktop** (Windows o Mac). No funciona en claude.ai desde el navegador ni en el celular.

## Instalar (5 minutos, fácil)

1. Abre Claude Desktop y entra a **Configuración → Extensiones**.
2. Arrastra el archivo `minoscreto.mcpb` a esa ventana (o haz doble clic en él).
3. Haz clic en **Instalar**.

   > **Nota:** Claude Desktop avisa que la extensión no está firmada. Es normal en esta versión de prueba.

4. Verifica que **Minoscreto** quede activado.

## Usar

> **Advertencia:** usa la pestaña **Chat** de Claude Desktop, sin otros conectores de archivos activos. En las pestañas Code o Cowork, Claude tiene sus propias herramientas para abrir archivos: el conector le pide no usarlas con tus documentos, pero no puede impedirlo. Si ves que Claude «lee» o «explora» el archivo antes de anonimizarlo, detenlo.

1. En un chat nuevo, escribe la ruta completa del archivo:

   ```text
   Anonimiza C:\Users\Ana\Documents\Caso Pérez.pdf y hazme un resumen del caso.
   ```

   Claude guarda dos archivos junto al original:
   - `documento-XXXX_protegido.md`: el texto con etiquetas. Este sí lo puedes compartir.
   - `Caso Pérez_diccionario-XXXX.json`: los datos reales. Queda en tu computador.

2. Revisa los datos ocultos por tipo que te muestra Claude. Para corregirlos, díselo:
   - «No ocultes `[PERSONA_3]`, es el juez».
   - «Oculta también "Finca La Esperanza"».

   Claude anonimiza de nuevo con un código nuevo.

3. Cuando quieras el resultado con los nombres reales, pídelo:

   ```text
   Restaura tu respuesta en un Word.
   ```

   Claude crea `Caso Pérez-restaurado.docx` junto al diccionario y te dice la ruta. Los datos reales no aparecen en el chat.

   También puedes restaurar un archivo que te devolvió otra IA: «Restaura C:\...\respuesta.docx con el diccionario C:\...\Caso Pérez_diccionario-XXXX.json».

> **Precaución:** no pegues el documento original en el chat. Dale siempre la ruta del archivo. Si pegas el texto, los datos ya salieron de tu computador.

> **Precaución:** no le pidas a Claude que abra el diccionario. Tiene los datos reales.

## Límites de esta versión

- Un PDF con contraseña no se abre aquí: quítale la contraseña o usa [minoscreto.netlify.app](https://minoscreto.netlify.app).
- Un PDF escaneado sin texto no se puede leer: hazle OCR primero.
- El PDF restaurado es de texto simple, sin el diseño original. Para conservar el formato, pide Word.
- Ningún archivo se sobrescribe: si el nombre ya existe, se crea `… (2)`.

## Para quien mantiene el conector

- Código: `mcp/server.mjs` (herramientas `anonimizar`, `leer_protegido`, `restaurar`) y `mcp/core.mjs` (usa el mismo `src/model` que la página).
- Pruebas: `npm test` en la raíz (`tests/mcp.test.js`, en Node sin navegador).
- Armar el `.mcpb`: `cd mcp`, luego `npm install` y `npm run pack`. El resultado queda en `mcp/build/minoscreto.mcpb`.
