# Guía funcional completa — Instructor de Logística

> Guía detallada migrada desde el antiguo `LEEME.md` (sin pérdida de contenido).
> El [README](../README.md) resume la aplicación; esta guía conserva el detalle
> de uso, formatos, retroalimentación, configuración, diagnóstico y solución de
> problemas. Documentación técnica: [arquitectura](arquitectura.md).

Aplicación local que evalúa trabajos y devuelve **retroalimentación como la de un instructor humano**: sencilla, directa y ajustada a las instrucciones que tú definas.

El usuario **solo sube el archivo**. No hay que digitar ni copiar datos del documento: la aplicación lee el contenido por sí sola (texto, tablas, imágenes, diapositivas y hasta fotogramas de video).

---

## Cómo se usa

1. Doble clic en **`Iniciar.bat`** (o ejecuta `node lib/server.js --open`).
2. Se abre el navegador en `http://127.0.0.1:5599`.
3. **Paso 1:** arrastra o selecciona el documento a evaluar.
4. **Paso 2:** escribe las instrucciones de evaluación **o** súbelas como archivo (PDF, Word, Excel, imagen…). Si lo dejas vacío, se aplica un criterio general de logística.
5. Pulsa **Evaluar mi trabajo** y lee la retroalimentación. Puedes copiarla o descargarla.

Para cerrar la aplicación: `Ctrl + C` en la ventana negra.

> Si `vendor/` no está instalado (por ejemplo al clonar el repositorio), `Iniciar.bat` lo instala automáticamente la primera vez. También puedes ejecutar `tools/preparar-vendor.ps1` a mano. Ver [`vendor/README.md`](../vendor/README.md).

---

## Formatos admitidos

| Categoría | Extensiones | Cómo se analiza |
|---|---|---|
| PDF | `.pdf` | Texto real; si es **escaneado** (sin texto) se convierte cada página a imagen y se analiza visualmente |
| Word | `.docx`, `.docm`, `.doc`, `.rtf`, `.odt` | Texto, tablas, encabezados y notas al pie |
| Excel | `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, `.tsv` | Rejilla de celdas reconstruida con referencias (A1, B2…) |
| PowerPoint | `.pptx`, `.ppsx`, `.ppt`, `.odp` | Texto por diapositiva + notas del orador |
| Imágenes | `.png`, `.jpg`, `.webp`, `.gif`, `.bmp`, `.tif`, `.heic`, `.avif` | Análisis visual directo |
| Video | `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`, otros | Fotogramas distribuidos en toda la línea de tiempo |
| Texto | `.txt`, `.md`, `.log`, `.json`, `.xml`, `.html`, `.srt`, `.vtt` | Lectura directa |
| Incrustados | — | Los diagramas, tablas y capturas dentro de Word/PPT/Excel se adjuntan como imagen |

> **Formatos antiguos de Office (`.doc`, `.xls`, `.ppt`):** se intenta recuperar el texto, pero la lectura puede ser parcial. Si la retroalimentación sale incompleta, guarda el archivo como PDF o en formato moderno y vuelve a subirlo. La aplicación te avisa cuando esto ocurre.

---

## Qué recibe el instructor virtual

Por cada archivo, la aplicación extrae automáticamente:

- **Texto** del documento (con tablas y estructura).
- **Imágenes** relevantes: páginas escaneadas, diagramas incrustados, capturas y fotogramas de video.
- **Datos de contexto**: número de páginas, palabras, hojas, diapositivas, duración del video, resolución, si trae audio, etc.

### Análisis de imágenes dentro de los documentos

La aplicación es **multimodal**: además del texto, envía al modelo las imágenes para que las analice. No hay que activar nada.

| Situación | Qué hace |
|---|---|
| **Word / PowerPoint / Excel con imágenes** | Extrae **todas** las imágenes incrustadas (diagramas, tablas, capturas, fotografías, firmas, iconos) y las envía al modelo, priorizando las de mayor tamaño |
| **PDF escaneado** (sin texto) | Convierte **todas** las páginas a imagen |
| **PDF con texto que además trae imágenes** | Detecta **qué páginas contienen imágenes** y las convierte, conservando también el texto |
| **PDF con texto sin imágenes** | Solo texto, para no gastar cupo innecesariamente |
| **Formatos exóticos** dentro de Office (TIFF, BMP, EMF, WMF, SVG) | Los convierte a PNG para poder analizarlos |
| **Video** | Fotogramas distribuidos en toda la línea de tiempo |

Solo se descartan las imágenes **verdaderamente decorativas**: puntos de menos de 32×32 píxeles, líneas y separadores, y las que se repiten idénticas. Todo lo demás se conserva, incluso iconos pequeños.

El mensaje que se envía al modelo incluye la instrucción explícita de **revisar cada imagen** y usar como evidencia lo que se ve en ellas (cifras, cargos, pasos del proceso, firmas, fechas), mencionando si contradicen o confirman el texto.

**Cupos:** hasta 22 imágenes por evaluación (16 incrustadas y 14 páginas de PDF como máximo, compartiendo el cupo total). Si el documento trae más, se envían las principales y la aplicación lo advierte en los detalles del análisis.

## Estructura de la retroalimentación

La respuesta sigue siempre el mismo orden, en lenguaje sencillo y en segunda persona:

1. **Qué observé** — resumen de lo entregado.
2. **Lo que está bien** — aciertos concretos, citando la evidencia del documento.
3. **Lo que hay que mejorar** — punto por punto: qué falta, por qué importa en logística y cómo corregirlo.
4. **Recomendaciones** — acciones prácticas y medibles.
5. **Cierre** — un comentario de ánimo, realista.

### Lista de verificación final (tabla)

Al final de **toda** evaluación la aplicación dibuja la tabla de verificación. La tabla **copia el formato de tus instrucciones**: si tu rúbrica es de casillas, sale con casillas; si es de puntaje, sale con puntaje.

**Si tus instrucciones son de lista de chequeo** (Cumple / No cumple, Sí / No, Aplica / No aplica), la tabla sale así:

| No. | Variables / indicadores de logro | CUMPLE SÍ | CUMPLE NO | Observaciones |
|---|---|---|---|---|
| 1 | Identificó la jerarquía de los cargos en el organigrama institucional. `20%` | ✓ 20% | | Incluye organigrama y tabla de niveles estratégico, táctico y operativo. |
| 2 | Interpretó las necesidades del departamento humano. `20%` | ✓ 20% | | Define necesidades de personal por área. |
| 3 | Diseñó el plan de acción con responsables y fechas. `20%` | | ✓ | No se definen responsables ni fechas. |
| | **TOTAL** | 2 de 3 | 1 de 3 | `Aprobado` · 3.3 de 5 |

**Si tus instrucciones dan puntajes**, sale con una sola columna de calificación mostrada como `obtenido / máximo`:

| No. | Criterio | CALIFICACIÓN | Observaciones |
|---|---|---|---|
| 1 | Claridad | `24 / 30` | Redacción clara y ordenada. |
| 2 | Análisis de causas | `7 / 40` | No explica el porqué de las desviaciones. |
| | **TOTAL** | 31 / 70 | `Reprobado` · 1.7 de 5 |

Detalles de funcionamiento:

- **La calificación final siempre aparece en la fila TOTAL.** Si tu rúbrica da un valor por criterio (por ejemplo 10 % cada uno), la tabla muestra el puntaje sobre el total: *80 de 100 puntos (80 %)*. Si el modelo no logra calcularlo, **la aplicación lo calcula sola** a partir de los criterios marcados y lo identifica con un asterisco.
- Los criterios aparecen **en el mismo orden** y con la **misma redacción** de tus instrucciones.
- Cada casilla marcada se muestra con ✓; si tu rúbrica trae un valor dentro de la casilla (por ejemplo `20%`), se conserva junto a la marca.
- Una marca en una columna negativa (**CUMPLE NO**) se pinta en rojo, no en verde.
- Los totales por columna se colorean: verde ≥70 %, ámbar ≥50 %, rojo por debajo.
- Debajo de la tabla aparece un resumen (por ejemplo *CUMPLE SÍ: 2 de 3 criterios*).
- La tabla se incluye también al usar **Copiar** y **Descargar**, en formato de texto alineado.
- Si el modelo no logra entregar la lista, la retroalimentación se conserva y se avisa en su lugar; nunca se rompe el resultado.

Para obtener exactamente el formato de tu rúbrica, **pega o sube las instrucciones tal como las tienes**, incluyendo los encabezados de las columnas y el valor de cada criterio (por ejemplo `... 10 %`). La aplicación usa esa redacción y calcula el puntaje total.

#### Si tu prompt pide "una tabla en Markdown"

Muchos docentes piden en sus instrucciones *"presenta la calificación en una tabla Markdown"*. **No hay que quitar esa frase:**

- La aplicación dibuja la tabla por ti, así que **no debe aparecer escrita como texto** en la retroalimentación (si aparece, se elimina para no duplicarla).
- Para que las instrucciones sean inequívocas, el programa le indica al modelo que esa petición se cumple con el bloque de datos interno, que es el que genera la tabla visual.
- Además hay un **respaldo**: si el modelo escribe igual la tabla en Markdown, la aplicación la **detecta y la convierte** en la tabla de rúbrica, en lugar de borrarla. También recupera de ahí el porcentaje total.

Con esto, un prompt como el del SENA (extraer el nombre del aprendiz, base mínima del 80 %, prosa cálida y tabla de calificación) funciona sin modificaciones: respeta la base del 80 %, califica el punto de la plataforma con el valor indicado y devuelve la tabla con los 8 indicadores.

Si tus instrucciones piden una nota o porcentaje, la calcula y la justifica. Si no lo piden, no inventa calificaciones numéricas y evalúa con criterio cualitativo.

---

## Configuración

La aplicación **ya viene configurada** y toma la clave de API del entorno
(`DEEPSEEK_API_KEY` o las credenciales locales `~/.dsh/.credentials.yaml`).
Para fijar la configuración del proyecto, copia el ejemplo y edítalo:

```powershell
copy data\config.example.json data\config.json
```

```json
{
  "apiKey": "tu-clave-aqui",
  "apiUrl": "https://api.deepseek.com/chat/completions",
  "model": "deepseek-flash",
  "port": 5599,
  "ffmpeg": "vendor/bin/ffmpeg.exe"
}
```

También se pueden usar variables de entorno: `DEEPSEEK_API_KEY`,
`DEEPSEEK_API_URL`, `DEEPSEEK_MODEL` y `PORT` (tienen prioridad sobre el
archivo). `HOST`, `FFMPEG_PATH` y `NO_OPEN` solo se definen por entorno.

| Opción | Por defecto | Descripción |
|---|---|---|
| `apiKey` | del entorno | Clave del servicio de IA |
| `apiUrl` | `https://api.deepseek.com/chat/completions` | Endpoint (compatible con OpenAI) |
| `model` | `deepseek-flash` | Modelo a usar (debe aceptar imágenes para análisis visual) |
| `port` | `5599` | Puerto local; si está ocupado, prueba el siguiente |
| `ffmpeg` | `vendor/bin/ffmpeg.exe` | Binario para analizar video |

`data/config.json` está en `.gitignore`: no se sube al repositorio.
`data/config.example.json` sí se versiona y no contiene secretos.

---

## Diagnóstico y pruebas

```bash
node tests/doctor.js               # verifica que todo esté en su lugar (requiere vendor)
node tests/make-fixtures.js        # genera documentos de ejemplo (Word, Excel, PPT, PDF escaneado)
node tests/make-video-fixture.js   # genera un video de ejemplo
node tests/test-extract.js         # prueba la extracción de cada formato
node tests/test-server.js          # prueba el flujo web completo (sin IA)
node tests/test-checklist.js       # prueba el análisis del bloque de lista de verificación
node tests/test-tabla-markdown.js   # prueba el respaldo: tabla Markdown -> tabla de rúbrica
node tests/test-tabla-render.js    # prueba la tabla final (ejecuta el código real de la interfaz)
node tests/test-lista-en-prosa.js  # prueba el respaldo: calificación en párrafos -> tabla
node tests/test-version-servida.js # verifica que el servidor sirva la versión actual (sin caché)
node tests/test-server.js --llm    # flujo completo + evaluación real con IA
node tests/test-extract.js --llm   # extracción + evaluación real de un archivo
node tests/test-checklist-live.js  # evaluación real + validación de la tabla
node tests/test-server-checklist.js # verifica que la tabla llegue al navegador
node tests/test-prompt-docente.js   # prueba con el prompt completo tipo SENA (4 pasos)
```

La suite sin IA ni binarios (`npm test`) ejecuta las pruebas de interfaz y de
lista de verificación que no necesitan `vendor/`; es la que corre en GitHub
Actions.

Los archivos de ejemplo se guardan en `tests/fixtures/` e incluyen un PDF normal, un PDF escaneado de una página, un escaneo de tres páginas, Word, Excel, PowerPoint, texto y video. Se pueden borrar sin afectar a la aplicación.

---

## Solución de problemas

**«No se pudo completar la evaluación — Failed to fetch»**
Significa que la aplicación se cerró y el navegador ya no encuentra el servidor local. Ocurre cuando se cierra la ventana negra en la que se inició, cuando el equipo se suspende o al apagarlo.

*Solución:* vuelve a abrir `Iniciar.bat` y recarga la página. Si la ventana negra sigue abierta, revisa la dirección que muestra: si el puerto 5599 estaba ocupado, la aplicación usa el siguiente puerto libre y debes entrar a esa dirección.

La app te avisa sola: si el servidor se cae, el indicador de arriba a la derecha cambia a **«Servidor detenido»** y la página explica qué hacer (lo revisa cada 20 segundos).

**Falta `vendor/` o aparecen errores de componentes**
Ejecuta `powershell -NoProfile -ExecutionPolicy Bypass -File tools\preparar-vendor.ps1`
(o abre `Iniciar.bat`, que lo lanza solo) y comprueba con `npm run doctor`.
Detalles en [`vendor/README.md`](../vendor/README.md).

**La API rechaza la clave o no hay saldo**
Revisa `data/config.json` o la variable `DEEPSEEK_API_KEY` (401 = clave
rechazada; 402 = cuenta sin saldo; 429 = demasiadas solicitudes).

**La retroalimentación dice que el documento está ilegible**
En un PDF escaneado, la calidad del escaneo es lo que decide. Vuelve a escanear con buena luz, sin inclinación y a mayor resolución, o exporta el PDF directamente desde Word.

**Un `.doc`, `.xls` o `.ppt` devuelve poco contenido**
Es un formato antiguo y la lectura es aproximada. Guarda el archivo como PDF o en formato moderno (`.docx`, `.xlsx`, `.pptx`) y vuelve a subirlo.

**El video se evalúa solo por lo que se ve**
El audio no se transcribe. Si la evaluación depende de una explicación hablada, no la detectará.

---

## Notas técnicas

- **Dependencias incluidas en el paquete:** `pdfjs-dist`, `@napi-rs/canvas` y `ffmpeg` viven en `vendor/`. En el repositorio no se versionan (ver `.gitignore`): se instalan con `tools/preparar-vendor.ps1` en versiones fijadas. El ZIP de distribución sí las incluye.
- **Sin dependencias npm:** el servidor usa solo módulos nativos de Node (`http`, `FormData`, `fetch`). Los multipart se procesan sin librerías externas.
- **Archivos grandes:** los PDF se limitan a 120 páginas y los adjuntos visuales a 22 imágenes. Se avisa en los detalles del análisis cuando se recorta algo.
- **Video:** se analiza lo que **se ve**. El audio no se transcribe (la API no lo admite); la aplicación lo advierte cuando el video trae pista de audio.
- **Privacidad:** los archivos se procesan en tu equipo y se envían al modelo de IA únicamente para generar la retroalimentación.
- **Node.js:** se requiere Node.js 22.13+ (`engines.node: >=22.13.0`), requisito de `pdfjs-dist@6.3.289`; el proyecto se ha probado con Node 24 (ver `vendor/README.md`).

### Estructura del proyecto

```text
Instructor-Logistica/
├── Iniciar.bat            Lanzador para Windows (instala vendor si falta)
├── package.json           Scripts npm (start, test, doctor, preparar-vendor, empaquetar)
├── README.md              Presentación y guía rápida
├── lib/
│   ├── server.js          Servidor HTTP, subidas y progreso en vivo (SSE)
│   ├── extract.js         Orquestador: elige cómo leer cada formato
│   ├── pdf.js             Lectura y rasterizado de PDF
│   ├── office.js          DOCX / XLSX / PPTX / ODF (lectura del ZIP interno)
│   ├── zip.js             Lector ZIP propio (sin dependencias)
│   ├── legacy.js          Recuperación de texto de .doc / .xls / .ppt
│   ├── video.js           Fotogramas y metadatos con ffmpeg
│   ├── raster.js          Renderizado de páginas a imagen
│   ├── images.js          Política de imágenes (qué se envía al modelo)
│   ├── content.js         Utilidades de texto y adjuntos
│   ├── llm.js             Instrucciones + contenido -> retroalimentación
│   ├── proc.js            Ejecución de procesos compatible con el sandbox
│   └── config.js          Configuración central y límites
├── public/                Interfaz web (HTML, CSS y JS sin frameworks)
├── vendor/                Dependencias binarias (no versionadas; ver README)
├── tools/                 preparar-vendor.ps1 y empaquetar.ps1
├── tests/                 Diagnóstico, fixtures y pruebas
├── docs/                  Arquitectura, guía, contrato de UI y capturas
└── data/                  Subidas y temporales (se limpian solos; ignorados por Git)
```
