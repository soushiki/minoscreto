# Minoscreto en Claude Desktop

Con este conector, Claude anonimiza y restaura tus documentos sin pasar por la página web. Todo ocurre en tu computador: Claude solo recibe el texto con etiquetas como `[PERSONA_1]`, nunca el documento original ni el diccionario.

Funciona en **Claude Desktop** (Windows o Mac). No funciona en claude.ai desde el navegador ni en el celular.

## Instalar (5 minutos, fácil)

1. Abre Claude Desktop y entra a **Configuración → Extensiones**.
2. Arrastra el archivo `minoscreto.mcpb` a esa ventana (o haz doble clic en él).
3. Haz clic en **Instalar**.

   > **Nota:** Claude Desktop avisa que la extensión no está firmada. Es normal en esta versión de prueba.

4. Verifica que **Minoscreto** quede activado.

## Usarlo también en la pestaña Code (10 minutos, fácil)

Las extensiones de **Configuración → Extensiones** solo se cargan en la pestaña **Chat**. Para tener Minoscreto en la pestaña **Code**, regístralo una vez en Claude Code:

1. Guarda `minoscreto.mcpb` en una carpeta fija, por ejemplo `Documentos`.
2. Abre una sesión nueva en la pestaña **Code**.
3. Pega este mensaje y cambia `RUTA_DEL_MCPB` por la ruta completa del archivo:

   ```text
   Configura el conector Minoscreto en Claude Code. No abras ningún documento mío.
   1. Revisa node --version. Si falta o es menor que 20.19, instálalo con winget install OpenJS.NodeJS.LTS.
   2. Crea la carpeta %USERPROFILE%\Minoscreto y descomprime ahí el archivo con: tar -xf "RUTA_DEL_MCPB" -C "%USERPROFILE%\Minoscreto"
   3. Regístralo para todos mis proyectos: claude mcp add minoscreto --scope user -- node "%USERPROFILE%\Minoscreto\mcp\server.mjs"
      Si el comando claude no existe, agrega en %USERPROFILE%\.claude.json, dentro de "mcpServers" del nivel superior:
      "minoscreto": {"type": "stdio", "command": "node", "args": ["<ruta completa de server.mjs>"]}
   4. Ejecuta claude mcp get minoscreto y dime si dice Connected.
   5. Agrega esta regla a %USERPROFILE%\.claude\CLAUDE.md (créalo si no existe), sin borrar lo que ya tenga:
      "Documentos con datos personales (expedientes, contratos, poderes, documentos de clientes): para anonimizarlos o
      trabajar con ellos usa solo la herramienta anonimizar de Minoscreto. Nunca abras el original con lectura de archivos,
      terminal, Python ni skills de PDF o Word. Si las herramientas de Minoscreto no están cargadas, detente y avísame:
      no anonimices con un script propio."
   ```

4. Cuando Claude diga **Connected**, cierra esa sesión y abre una nueva. Las herramientas se cargan al iniciar una sesión.

> **Nota:** para documentos sin datos personales, la pestaña Code funciona como siempre. La regla solo aplica cuando el documento tiene datos personales.

> **Nota:** al recibir una versión nueva de `minoscreto.mcpb`, repite el paso 2 del mensaje en la misma carpeta y abre una sesión nueva.

## Usar

> **Advertencia:** la pestaña **Chat** es la más segura, siempre que no tengas otros conectores de archivos activos: ahí Claude no tiene cómo abrir el archivo por su cuenta. En la pestaña Code, Claude tiene sus propias herramientas para abrir archivos. El conector y la regla de `CLAUDE.md` le piden no usarlas con tus documentos, pero no pueden impedirlo. Si ves que Claude «lee» o «explora» el archivo antes de llamar a anonimizar, detenlo.

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
