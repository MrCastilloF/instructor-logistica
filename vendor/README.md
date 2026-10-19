# vendor/ — dependencias binarias (no versionadas)

Este directorio guarda las dependencias que la aplicación necesita para leer
documentos y video. **Sus binarios no se suben a GitHub** (el repositorio es
liviano): se instalan con un script que fija las versiones exactas.

```
vendor/
├── pdfjs-dist/                                  PDF.js 6.3.289
│   ├── legacy/build/pdf.mjs + pdf.worker.mjs
│   ├── standard_fonts/  cmaps/  wasm/  iccs/
│   └── LICENSE  package.json
├── node_modules/@napi-rs/
│   ├── canvas/                                  @napi-rs/canvas 1.0.9
│   └── canvas-win32-x64-msvc/                   binario nativo (skia)
├── bin/ffmpeg.exe + ffmpeg.LICENSE.txt          FFmpeg 6.0 essentials
└── README.md                                    este archivo
```

## Instalación

Desde la raíz del proyecto, en Windows x64 con Node.js 22.13+ y conexión a internet:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\preparar-vendor.ps1
```

También puedes usar `npm run preparar-vendor`. El script:

1. Comprueba Node.js 22.13+ y npm.
2. Instala con npm las versiones fijadas en `data\tmp\vendor-build`:
   - `pdfjs-dist@6.3.289`
   - `@napi-rs/canvas@1.0.9` y `@napi-rs/canvas-win32-x64-msvc@1.0.9`
3. Instala FFmpeg 6.0 essentials con el paquete npm fijado `ffmpeg-static@5.2.0`
   (incluye la build 6.0 essentials de gyan.dev) y, si eso falla, descarga como
   respaldo el ZIP *release essentials* actual de gyan.dev.
4. Copia a `vendor/` **solo lo que la aplicación usa** (no el paquete npm completo).
5. Verifica que `@napi-rs/canvas` genere un PNG, que exista
   `vendor/pdfjs-dist/legacy/build/pdf.mjs` y que `ffmpeg.exe -version` responda.

Es idempotente: si `vendor/` ya está completo y verificado, no cambia nada.
Opciones:

| Comando | Efecto |
|---|---|
| `... -Check` | Solo verifica la instalación; no modifica archivos. Código 0 si está bien. |
| `... -Force` | Reinstala aunque ya esté completo. |
| `... -Destino data\tmp\prueba-vendor` | Instala en una carpeta alternativa (pruebas). |

### Alternativa manual

Si no hay internet desde el script, descarga las piezas por separado y deja
esta estructura:

- `pdfjs-dist` 6.3.289 desde <https://www.npmjs.com/package/pdfjs-dist>: copia
  `legacy/build/pdf.mjs`, `legacy/build/pdf.worker.mjs`, `legacy/build/pdf.sandbox.mjs`,
  las carpetas `standard_fonts/`, `cmaps/`, `wasm/`, `iccs/` y `LICENSE`.
- `@napi-rs/canvas` 1.0.9 y `@napi-rs/canvas-win32-x64-msvc` 1.0.9 desde npm,
  en `vendor/node_modules/@napi-rs/`.
- `ffmpeg.exe` de una build 6.0 essentials para Windows x64 en `vendor/bin/`.
  Puedes copiarlo de `node_modules/ffmpeg-static/ffmpeg.exe` tras instalar
  `ffmpeg-static@5.2.0` con npm. También sirve un `ffmpeg.exe` de otra build
  reciente (el código solo usa `-i`, filtros `scale`/`fps` y salida JPEG).
  > Nota: la URL histórica de gyan.dev para el ZIP de 6.0
  > (`.../packages/ffmpeg-6.0-essentials_build.zip`) ya devuelve 404. Por eso la
  > vía principal es el paquete npm fijado; el respaldo web usa la build actual
  > de gyan.dev (`ffmpeg-release-essentials.zip`), que puede ser más nueva que 6.0.

## Verificación

```powershell
npm run doctor
```

El diagnóstico comprueba Node.js, la clave de API, `public/`, PDF.js, canvas
nativo (genera un PNG de prueba), `ffmpeg.exe`, la escritura en `data/`,
la lectura de un PDF y la extracción de fotogramas de video.

## Licencias

Las dependencias conservan sus propias licencias y sus archivos de licencia se
copian junto a ellas:

- **PDF.js** — Apache-2.0 (`vendor/pdfjs-dist/LICENSE`).
- **@napi-rs/canvas** — MIT (`vendor/node_modules/@napi-rs/canvas/LICENSE`).
- **FFmpeg** — el build *essentials* de gyan.dev es GPLv3 (incluye x264/x265).
  Es un ejecutable independiente invocado por la aplicación; si redistribuyes
  el paquete con `vendor/`, revisa los términos de la GPL de FFmpeg.

## Nota sobre Node.js

`pdfjs-dist@6.3.289` declara en su `package.json` compatibilidad con
`node >=22.13.0 || >=24`. Por eso el proyecto fija Node.js **22.13** como mínimo
(`engines.node: >=22.13.0`), que es el requisito real de PDF.js. Este proyecto
se ha probado con Node.js 24.
