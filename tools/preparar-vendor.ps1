#Requires -Version 5.1
<#
.SYNOPSIS
  Instala las dependencias binarias del Instructor de Logistica en vendor/.

.DESCRIPTION
  El repositorio es liviano: los binarios NO se versionan. Este script descarga
  las versiones fijadas y deja vendor/ con exactamente lo que la aplicacion usa:

    vendor/pdfjs-dist/                                pdfjs-dist 6.3.289
    vendor/node_modules/@napi-rs/canvas/              @napi-rs/canvas 1.0.9
    vendor/node_modules/@napi-rs/canvas-win32-x64-msvc/
    vendor/bin/ffmpeg.exe                             FFmpeg 6.0 essentials (gyan.dev)

  FFmpeg se obtiene del paquete npm fijado ffmpeg-static@5.2.0, que incluye la
  build 6.0 essentials de gyan.dev. Si npm falla, se descarga como respaldo el
  ZIP release-essentials de gyan.dev (build actual, no la version 6.0 fijada).

  Requiere Windows x64, Node.js 20+ (recomendado 22/24) y conexion a internet.
  El script es idempotente: si todo esta instalado y verificado, no hace nada.

.PARAMETER Force
  Reinstala aunque vendor/ ya este completo. No borra nada fuera de vendor/.

.PARAMETER Check
  Solo comprueba la instalacion actual y termina. No modifica ningun archivo.
  Devuelve codigo 0 si todo esta correcto y 1 si falta algo.

.PARAMETER Destino
  Carpeta de destino alternativa (por defecto: vendor/). Pensada para pruebas
  en un directorio temporal sin tocar la instalacion real.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/preparar-vendor.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/preparar-vendor.ps1 -Check

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/preparar-vendor.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$Check,
  [string]$Destino = ""
)

$ErrorActionPreference = "Stop"
# Desactiva la barra de progreso de Invoke-WebRequest (en PS 5.1 frena mucho la descarga).
$ProgressPreference = "SilentlyContinue"

# ---------------------------------------------------------------------------
# Versiones fijadas. No cambiar sin actualizar vendor/README.md y probar la app.
# ---------------------------------------------------------------------------
$VERSION_PDFJS = "6.3.289"
$VERSION_CANVAS = "1.0.9"
$VERSION_FFMPEG_STATIC = "5.2.0"
# Respaldo si ffmpeg-static no se puede instalar: build release "essentials" actual
# de gyan.dev (el ZIP historico de 6.0 ya no existe en gyan.dev: devuelve 404).
$URL_FFMPEG = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

$RAIZ = Split-Path -Parent $PSScriptRoot
$BUILD = Join-Path $RAIZ "data\tmp\vendor-build"

if (-not (Test-Path (Join-Path $RAIZ "lib\server.js"))) {
  throw "No se encontro lib\server.js. Ejecuta este script desde la carpeta del proyecto (tools\preparar-vendor.ps1)."
}

if ([string]::IsNullOrWhiteSpace($Destino)) {
  $VENDOR = Join-Path $RAIZ "vendor"
} elseif ([System.IO.Path]::IsPathRooted($Destino)) {
  $VENDOR = $Destino
} else {
  $VENDOR = Join-Path (Get-Location).Path $Destino
}
$VENDOR = [System.IO.Path]::GetFullPath($VENDOR).TrimEnd('\', '/')

# npm puede estar instalado como npm.cmd (Windows), npm.ps1 (PowerShell) o npm (otros).
$script:NPM_CMD = "npm"
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
  $script:NPM_CMD = "npm.cmd"
}

# ---------------------------------------------------------------------------
# Utilidades de salida
# ---------------------------------------------------------------------------
function Escribir-Titulo([string]$texto) {
  Write-Host ""
  Write-Host "  $texto" -ForegroundColor Cyan
}

function Escribir-Paso([string]$texto) {
  Write-Host "  [..] $texto" -ForegroundColor Yellow
}

function Escribir-Ok([string]$texto) {
  Write-Host "  [ok] $texto" -ForegroundColor Green
}

function Escribir-Aviso([string]$texto) {
  Write-Host "  [!]  $texto" -ForegroundColor DarkYellow
}

function Escribir-Error([string]$texto) {
  Write-Host "  [x]  $texto" -ForegroundColor Red
}

# ---------------------------------------------------------------------------
# Verificacion de requisitos
# ---------------------------------------------------------------------------
function Comprobar-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "No se encontro Node.js. Instala Node.js 20 o superior desde https://nodejs.org y vuelve a intentarlo."
  }
  $version = (& node --version).Trim()
  $mayor = 0
  $menor = 0
  try {
    $partes = $version.TrimStart("v").Split(".")
    $mayor = [int]$partes[0]
    $menor = [int]$partes[1]
  } catch {
    throw "No se pudo leer la version de Node.js ('$version')."
  }
  if ($mayor -lt 20) {
    throw "Se requiere Node.js 20 o superior (version actual: $version). Descargalo en https://nodejs.org"
  }
  Escribir-Ok "Node.js $version"
  if ($mayor -lt 22 -or ($mayor -eq 22 -and $menor -lt 13)) {
    Escribir-Aviso "pdfjs-dist $VERSION_PDFJS declara Node 22.13+; en Node $mayor.$menor puede no funcionar. Se recomienda Node 22 LTS o 24."
  }

  $npm = Get-Command $script:NPM_CMD -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "No se encontro npm (viene con Node.js). Reinstala Node.js desde https://nodejs.org"
  }
  return $version
}

# ---------------------------------------------------------------------------
# Verificacion de una instalacion (real o en staging). Devuelve $true/$false.
# ---------------------------------------------------------------------------
function Probar-Instalacion([string]$dirVendor, [switch]$Silencioso) {
  $problemas = New-Object System.Collections.Generic.List[string]

  $pdf = Join-Path $dirVendor "pdfjs-dist\legacy\build\pdf.mjs"
  $pdfWorker = Join-Path $dirVendor "pdfjs-dist\legacy\build\pdf.worker.mjs"
  if ((Test-Path $pdf) -and (Test-Path $pdfWorker)) {
    if (-not $Silencioso) { Escribir-Ok "pdfjs-dist: legacy\build\pdf.mjs + pdf.worker.mjs" }
  } else {
    $problemas.Add("faltan archivos de vendor\pdfjs-dist\legacy\build (pdf.mjs / pdf.worker.mjs)")
  }

  $canvasDir = Join-Path $dirVendor "node_modules\@napi-rs\canvas"
  $canvasWinDir = Join-Path $dirVendor "node_modules\@napi-rs\canvas-win32-x64-msvc"
  if (-not (Test-Path $canvasDir)) { $problemas.Add("falta vendor\node_modules\@napi-rs\canvas") }
  if (-not (Test-Path $canvasWinDir)) { $problemas.Add("falta vendor\node_modules\@napi-rs\canvas-win32-x64-msvc") }

  if ((Test-Path $canvasDir) -and (Test-Path $canvasWinDir)) {
    $codigo = 0
    $salida = & node -e "try{const m=require(process.argv[1]);const c=m.createCanvas(16,16);const x=c.getContext('2d');x.fillStyle='#0a0';x.fillRect(0,0,8,8);const b=c.toBuffer('image/png');if(!b||!b.length)throw new Error('PNG vacio');process.exit(0)}catch(e){console.error('canvas: '+e.message);process.exit(1)}" $canvasDir 2>&1
    $codigo = $LASTEXITCODE
    if ($codigo -eq 0) {
      if (-not $Silencioso) { Escribir-Ok "Canvas nativo: genera imagenes PNG" }
    } else {
      $problemas.Add("el modulo canvas no funciona (" + (($salida | Out-String).Trim()) + ")")
    }
  }

  $ffmpeg = Join-Path $dirVendor "bin\ffmpeg.exe"
  if (Test-Path $ffmpeg) {
    $salidaFfmpeg = & $ffmpeg -version 2>&1
    $codigoFfmpeg = $LASTEXITCODE
    $primera = ($salidaFfmpeg | Select-Object -First 1 | Out-String).Trim()
    if ($codigoFfmpeg -eq 0 -and $primera -match "ffmpeg version") {
      if (-not $Silencioso) { Escribir-Ok "ffmpeg: $primera" }
    } else {
      $problemas.Add("vendor\bin\ffmpeg.exe no responde a -version")
    }
  } else {
    $problemas.Add("falta vendor\bin\ffmpeg.exe")
  }

  if ($problemas.Count -gt 0) {
    foreach ($p in $problemas) { Escribir-Error $p }
    return $false
  }
  return $true
}

# ---------------------------------------------------------------------------
# Instalacion con npm de las dependencias fijadas
# ---------------------------------------------------------------------------
function Instalar-ConNpm {
  if (Test-Path $BUILD) {
    Escribir-Paso "Limpiando carpeta de trabajo anterior (data\tmp\vendor-build)..."
    Remove-Item -LiteralPath $BUILD -Recurse -Force
  }
  New-Item -ItemType Directory -Path $BUILD -Force | Out-Null

  # package.json propio: fija las versiones y evita que npm use el proyecto raiz.
  $paquete = @"
{
  "name": "instructor-logistica-vendor-build",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "pdfjs-dist": "$VERSION_PDFJS",
    "@napi-rs/canvas": "$VERSION_CANVAS",
    "@napi-rs/canvas-win32-x64-msvc": "$VERSION_CANVAS"
  }
}
"@
  Set-Content -LiteralPath (Join-Path $BUILD "package.json") -Value $paquete -Encoding ASCII

  Escribir-Paso "Descargando paquetes fijados con npm (requiere internet)..."
  Write-Host "         pdfjs-dist@$VERSION_PDFJS  @napi-rs/canvas@$VERSION_CANVAS  @napi-rs/canvas-win32-x64-msvc@$VERSION_CANVAS" -ForegroundColor DarkGray

  Push-Location $BUILD
  try {
    $salida = & $script:NPM_CMD install --no-audit --no-fund --loglevel=error 2>&1
    $codigo = $LASTEXITCODE
    if ($salida) {
      foreach ($linea in $salida) { Write-Host ("         " + $linea) -ForegroundColor DarkGray }
    }
    if ($codigo -ne 0) {
      throw "npm install fallo (codigo $codigo). Comprueba la conexion a internet, el proxy o los permisos de escritura en data\tmp."
    }
  } finally {
    Pop-Location
  }

  $pdfOrigen = Join-Path $BUILD "node_modules\pdfjs-dist"
  $canvasOrigen = Join-Path $BUILD "node_modules\@napi-rs\canvas"
  $canvasWinOrigen = Join-Path $BUILD "node_modules\@napi-rs\canvas-win32-x64-msvc"
  foreach ($ruta in @($pdfOrigen, $canvasOrigen, $canvasWinOrigen)) {
    if (-not (Test-Path $ruta)) {
      throw "npm no dejo la dependencia esperada: $ruta. Revisa la version fijada o el registro de npm."
    }
  }
  Escribir-Ok "Paquetes npm descargados"
}

# ---------------------------------------------------------------------------
# FFmpeg 6.0 essentials: primero el paquete npm fijado ffmpeg-static@5.2.0
# (incluye la build 6.0 essentials de gyan.dev); respaldo: ZIP de gyan.dev.
# ---------------------------------------------------------------------------
function Obtener-Ffmpeg {
  Escribir-Paso "Instalando FFmpeg 6.0 essentials con npm ffmpeg-static@$VERSION_FFMPEG_STATIC..."
  Push-Location $BUILD
  try {
    $salida = & $script:NPM_CMD install --no-save --no-package-lock --no-audit --no-fund --loglevel=error "ffmpeg-static@$VERSION_FFMPEG_STATIC" 2>&1
    $codigo = $LASTEXITCODE
    if ($salida) {
      foreach ($linea in $salida) { Write-Host ("         " + $linea) -ForegroundColor DarkGray }
    }
    if ($codigo -ne 0) {
      throw "npm install de ffmpeg-static fallo (codigo $codigo)."
    }
    $exe = Join-Path $BUILD "node_modules\ffmpeg-static\ffmpeg.exe"
    if (-not (Test-Path $exe)) {
      throw "ffmpeg-static no incluye ffmpeg.exe."
    }
    $licencia = Join-Path $BUILD "node_modules\ffmpeg-static\ffmpeg.exe.LICENSE"
    if (Test-Path $licencia) { $script:FFMPEG_LICENSE = $licencia } else { $script:FFMPEG_LICENSE = "" }
    Escribir-Ok "FFmpeg 6.0 essentials instalado con npm ffmpeg-static"
    return $exe
  } catch {
    Escribir-Aviso ("No se pudo instalar ffmpeg-static: " + $_.Exception.Message)
    Escribir-Paso "Respaldo: descargando FFmpeg release essentials de gyan.dev (build actual)..."
    Write-Host "         $URL_FFMPEG" -ForegroundColor DarkGray
    $zip = Join-Path $BUILD "ffmpeg-release-essentials.zip"
    $extraido = Join-Path $BUILD "ffmpeg-extraido"
    try {
      Invoke-WebRequest -Uri $URL_FFMPEG -OutFile $zip -UseBasicParsing -TimeoutSec 900
      if (Test-Path $extraido) { Remove-Item -LiteralPath $extraido -Recurse -Force }
      Expand-Archive -LiteralPath $zip -DestinationPath $extraido -Force
      $exe = Get-ChildItem -LiteralPath $extraido -Recurse -Filter "ffmpeg.exe" -File | Select-Object -First 1
      if (-not $exe) {
        throw "El ZIP descargado no contiene ffmpeg.exe."
      }
      $licencia = Get-ChildItem -LiteralPath $extraido -Recurse -Filter "LICENSE*" -File | Select-Object -First 1
      if ($licencia) { $script:FFMPEG_LICENSE = $licencia.FullName } else { $script:FFMPEG_LICENSE = "" }
      Escribir-Ok "FFmpeg descargado y extraido"
      return $exe.FullName
    } catch {
      throw ("No se pudo obtener FFmpeg. Comprueba la conexion a internet, el proxy o los permisos de escritura. " +
        "Puedes descargar manualmente $URL_FFMPEG, extraer ffmpeg.exe y copiarlo en vendor\bin\ffmpeg.exe. " +
        "Detalle: " + $_.Exception.Message)
    }
  } finally {
    Pop-Location
  }
}

# ---------------------------------------------------------------------------
# Preparacion del staging: solo lo que la aplicacion necesita
# ---------------------------------------------------------------------------
function Preparar-Staging {
  $staging = Join-Path $BUILD "staging"
  if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }

  $pdfDestino = Join-Path $staging "pdfjs-dist"
  $napiDestino = Join-Path $staging "node_modules\@napi-rs"
  $binDestino = Join-Path $staging "bin"
  foreach ($d in @($pdfDestino, (Join-Path $pdfDestino "legacy\build"), $napiDestino, $binDestino)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
  }

  # pdfjs: solo el build legacy (pdf.mjs + worker), fuentes estandar, CMaps, wasm e ICC.
  $pdfOrigen = Join-Path $BUILD "node_modules\pdfjs-dist"
  foreach ($archivo in @("pdf.mjs", "pdf.worker.mjs", "pdf.sandbox.mjs")) {
    Copy-Item -LiteralPath (Join-Path $pdfOrigen "legacy\build\$archivo") -Destination (Join-Path $pdfDestino "legacy\build") -Force
  }
  foreach ($carpeta in @("standard_fonts", "cmaps", "wasm", "iccs")) {
    $origen = Join-Path $pdfOrigen $carpeta
    if (Test-Path $origen) {
      Copy-Item -LiteralPath $origen -Destination $pdfDestino -Recurse -Force
    } else {
      Escribir-Aviso "pdfjs-dist no incluye la carpeta $carpeta (no es imprescindible)."
    }
  }
  foreach ($archivo in @("LICENSE", "package.json")) {
    $origen = Join-Path $pdfOrigen $archivo
    if (Test-Path $origen) { Copy-Item -LiteralPath $origen -Destination $pdfDestino -Force }
  }
  Escribir-Ok "pdfjs-dist preparado"

  # canvas: el paquete JS y el binario nativo de Windows x64.
  Copy-Item -LiteralPath (Join-Path $BUILD "node_modules\@napi-rs\canvas") -Destination $napiDestino -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $BUILD "node_modules\@napi-rs\canvas-win32-x64-msvc") -Destination $napiDestino -Recurse -Force
  Escribir-Ok "canvas preparado"

  # ffmpeg (y su licencia, para cumplir con la GPL al redistribuir el ZIP)
  $ffmpegOrigen = Obtener-Ffmpeg
  Copy-Item -LiteralPath $ffmpegOrigen -Destination (Join-Path $binDestino "ffmpeg.exe") -Force
  if ($script:FFMPEG_LICENSE -and (Test-Path $script:FFMPEG_LICENSE)) {
    Copy-Item -LiteralPath $script:FFMPEG_LICENSE -Destination (Join-Path $binDestino "ffmpeg.LICENSE.txt") -Force
  }
  Escribir-Ok "ffmpeg preparado"

  return $staging
}

# ---------------------------------------------------------------------------
# Publicacion en vendor/ (solo despues de verificar el staging)
# ---------------------------------------------------------------------------
function Publicar-EnVendor([string]$staging) {
  $nodeModules = Join-Path $VENDOR "node_modules\@napi-rs"
  $bin = Join-Path $VENDOR "bin"
  New-Item -ItemType Directory -Path $VENDOR -Force | Out-Null
  New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null
  New-Item -ItemType Directory -Path $bin -Force | Out-Null

  # Borrado quirurgico: solo las piezas que administra este script.
  $objetivos = @(
    (Join-Path $VENDOR "pdfjs-dist"),
    (Join-Path $VENDOR "node_modules\@napi-rs\canvas"),
    (Join-Path $VENDOR "node_modules\@napi-rs\canvas-win32-x64-msvc"),
    (Join-Path $VENDOR "bin\ffmpeg.exe"),
    (Join-Path $VENDOR "bin\ffmpeg.LICENSE.txt")
  )
  foreach ($objetivo in $objetivos) {
    if (-not $objetivo.StartsWith($VENDOR, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Ruta de borrado inesperada: $objetivo"
    }
    if (Test-Path $objetivo) {
      Remove-Item -LiteralPath $objetivo -Recurse -Force
    }
  }

  Copy-Item -LiteralPath (Join-Path $staging "pdfjs-dist") -Destination $VENDOR -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $staging "node_modules\@napi-rs\canvas") -Destination $nodeModules -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $staging "node_modules\@napi-rs\canvas-win32-x64-msvc") -Destination $nodeModules -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $staging "bin\ffmpeg.exe") -Destination $bin -Force
  $licenciaStaging = Join-Path $staging "bin\ffmpeg.LICENSE.txt"
  if (Test-Path $licenciaStaging) {
    Copy-Item -LiteralPath $licenciaStaging -Destination $bin -Force
  }
  Escribir-Ok "Componentes copiados a $VENDOR"
}

# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------
try {
  Escribir-Titulo "Preparando dependencias de vendor/ (Instructor de Logistica 2.0.0)"
  Write-Host "  Destino: $VENDOR" -ForegroundColor DarkGray
  Comprobar-Node | Out-Null

  if (-not [System.Environment]::Is64BitOperatingSystem) {
    throw "Este paquete es para Windows x64. En un sistema de 32 bits no hay binario de canvas/ffmpeg."
  }
  if (-not [System.Environment]::Is64BitProcess -and $env:PROCESSOR_ARCHITECTURE -notmatch "64") {
    Escribir-Aviso "El proceso de PowerShell no es de 64 bits; el binario de canvas es win32-x64."
  }

  if ($Check) {
    Escribir-Titulo "Verificando la instalacion actual (modo -Check)"
    if (Probar-Instalacion $VENDOR) {
      Escribir-Titulo "Todo correcto."
      exit 0
    }
    Escribir-Titulo "Faltan componentes. Ejecuta el script sin -Check para instalarlos."
    exit 1
  }

  if (-not $Force) {
    Write-Host ""
    Write-Host "  Comprobando si vendor/ ya esta completo..." -ForegroundColor DarkGray
    if (Probar-Instalacion $VENDOR -Silencioso) {
      Escribir-Titulo "vendor/ ya estaba instalado y verificado. No se cambio nada. Usa -Force para reinstalar."
      exit 0
    }
    Escribir-Aviso "La instalacion esta incompleta; se reinstalaran los componentes."
  }

  Escribir-Titulo "1/4 Instalando paquetes npm"
  Instalar-ConNpm

  Escribir-Titulo "2/4 Preparando archivos y descargando FFmpeg"
  $staging = Preparar-Staging

  Escribir-Titulo "3/4 Verificando el staging antes de publicar"
  if (-not (Probar-Instalacion $staging -Silencioso)) {
    throw "La verificacion del staging fallo; no se modifico vendor/. Revisa los mensajes anteriores."
  }
  Escribir-Ok "Staging verificado"

  Escribir-Titulo "4/4 Publicando en vendor/"
  Publicar-EnVendor $staging

  Escribir-Titulo "Verificacion final"
  if (-not (Probar-Instalacion $VENDOR)) {
    throw "La instalacion quedo con problemas. Revisa los mensajes anteriores."
  }

  Escribir-Paso "Limpiando archivos temporales de instalacion..."
  if (-not $VENDOR.StartsWith($BUILD, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $BUILD -Recurse -Force -ErrorAction SilentlyContinue
  }

  Escribir-Titulo "Listo. vendor/ quedo instalado y verificado."
  Write-Host "  Ahora puedes iniciar la aplicacion con Iniciar.bat o: npm start" -ForegroundColor Green
  exit 0
} catch {
  Write-Host ""
  Escribir-Error $_.Exception.Message
  Write-Host ""
  Write-Host "  Sugerencias:" -ForegroundColor Yellow
  Write-Host "   - Comprueba la conexion a internet y el proxy."
  Write-Host "   - Verifica permisos de escritura en la carpeta del proyecto."
  Write-Host "   - Node.js 20+ y npm deben estar en el PATH."
  Write-Host "   - Si falla la descarga de FFmpeg, puedes copiar ffmpeg.exe manualmente en vendor\bin\."
  Write-Host ""
  exit 1
}
