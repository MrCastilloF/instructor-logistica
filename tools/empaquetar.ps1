#Requires -Version 5.1
<#
.SYNOPSIS
  Empaqueta la aplicacion lista para usar en dist/Instructor-Logistica-<version>-win64.zip.

.DESCRIPTION
  Genera un ZIP autocontenido: la aplicacion + public/ + lib/ + vendor/ ya instalado
  + documentacion. No incluye data/tmp, data/uploads, data/config.json, .git,
  dist/ ni node_modules de la raiz.

  Si vendor/ no esta instalado, el script se detiene con un mensaje claro (el ZIP
  no serviria para evaluar PDF, Office ni video). Usa -SinVendor solo si quieres
  un paquete de codigo/documentacion sin binarios.

.PARAMETER SinVendor
  Genera el ZIP sin vendor/ aunque esté instalado. La aplicacion resultante pedira
  instalar dependencias la primera vez (Iniciar.bat detecta que faltan).

.PARAMETER Salida
  Ruta alternativa para el ZIP. Por defecto: dist\Instructor-Logistica-<version>-win64.zip

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/empaquetar.ps1

.EXAMPLE
  npm run empaquetar
#>
[CmdletBinding()]
param(
  [switch]$SinVendor,
  [string]$Salida = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RAIZ = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RAIZ "lib\server.js"))) {
  throw "No se encontro lib\server.js. Ejecuta este script desde la carpeta del proyecto."
}

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

# Version desde package.json (fuente unica de verdad).
$version = "2.0.0"
$paquete = Join-Path $RAIZ "package.json"
if (Test-Path $paquete) {
  try {
    $json = Get-Content -LiteralPath $paquete -Raw | ConvertFrom-Json
    if ($json.version) { $version = [string]$json.version }
  } catch {
    throw "No se pudo leer package.json: $($_.Exception.Message)"
  }
}

if ([string]::IsNullOrWhiteSpace($Salida)) {
  $zip = Join-Path $RAIZ ("dist\Instructor-Logistica-$version-win64.zip")
} elseif ([System.IO.Path]::IsPathRooted($Salida)) {
  $zip = $Salida
} else {
  $zip = Join-Path $RAIZ $Salida
}

# ---------------------------------------------------------------------------
# Comprobaciones previas
# ---------------------------------------------------------------------------
$requeridos = @(
  (Join-Path $RAIZ "Iniciar.bat"),
  (Join-Path $RAIZ "package.json"),
  (Join-Path $RAIZ "lib\server.js"),
  (Join-Path $RAIZ "public\index.html"),
  (Join-Path $RAIZ "public\app.js"),
  (Join-Path $RAIZ "public\estilos.css")
)
foreach ($ruta in $requeridos) {
  if (-not (Test-Path $ruta)) {
    throw "Falta un archivo indispensable para empaquetar: $ruta"
  }
}

$vendor = Join-Path $RAIZ "vendor"
$vendorCompleto = (Test-Path (Join-Path $vendor "pdfjs-dist\legacy\build\pdf.mjs")) -and
  (Test-Path (Join-Path $vendor "node_modules\@napi-rs\canvas")) -and
  (Test-Path (Join-Path $vendor "node_modules\@napi-rs\canvas-win32-x64-msvc")) -and
  (Test-Path (Join-Path $vendor "bin\ffmpeg.exe"))

if (-not $vendorCompleto) {
  if (-not $SinVendor) {
    Escribir-Error "vendor/ no esta instalado o esta incompleto."
    Write-Host ""
    Write-Host "  Un ZIP sin vendor/ no puede leer PDF, Office ni video." -ForegroundColor Yellow
    Write-Host "  Instala primero las dependencias:" -ForegroundColor Yellow
    Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File tools\preparar-vendor.ps1" -ForegroundColor Yellow
    Write-Host "  (o ejecuta npm run preparar-vendor)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Si solo quieres un paquete de codigo/documentacion, usa -SinVendor." -ForegroundColor Yellow
    exit 1
  }
  Escribir-Aviso "vendor/ no esta instalado; el ZIP se generara SIN binarios (-SinVendor)."
} elseif (-not $SinVendor) {
  Escribir-Ok "vendor/ instalado y completo"
}

# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------
$stagingBase = Join-Path $RAIZ "data\tmp\empaquetar"
$staging = Join-Path $stagingBase "Instructor-Logistica-$version"
if (Test-Path $stagingBase) {
  # Borrado quirurgico: solo la carpeta de staging dentro de data\tmp.
  if (-not $stagingBase.StartsWith((Join-Path $RAIZ "data\tmp"), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Ruta de staging inesperada: $stagingBase"
  }
  Remove-Item -LiteralPath $stagingBase -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

function Copiar-Directorio([string]$origen, [string]$destinoPadre) {
  Copy-Item -LiteralPath $origen -Destination $destinoPadre -Recurse -Force
}

Escribir-Paso "Copiando aplicacion..."
foreach ($archivo in @("Iniciar.bat", "package.json", "README.md")) {
  $origen = Join-Path $RAIZ $archivo
  if (Test-Path $origen) { Copy-Item -LiteralPath $origen -Destination $staging -Force }
}
foreach ($carpeta in @("lib", "public", "tests", "tools", "docs")) {
  $origen = Join-Path $RAIZ $carpeta
  if (Test-Path $origen) { Copiar-Directorio $origen $staging }
}

# data/ solo con el ejemplo de configuracion; nunca subidas ni temporales.
$dataDestino = Join-Path $staging "data"
New-Item -ItemType Directory -Path $dataDestino -Force | Out-Null
$configEjemplo = Join-Path $RAIZ "data\config.example.json"
if (Test-Path $configEjemplo) {
  Copy-Item -LiteralPath $configEjemplo -Destination $dataDestino -Force
} else {
  Escribir-Aviso "No existe data\config.example.json; el ZIP no incluira configuracion de ejemplo."
}

if ($SinVendor) {
  Escribir-Aviso "Se empaqueta SIN vendor/ (-SinVendor): la app pedira instalarlo al abrirse."
  $vendorDestino = Join-Path $staging "vendor"
  New-Item -ItemType Directory -Path $vendorDestino -Force | Out-Null
  $vendorReadme = Join-Path $vendor "README.md"
  if (Test-Path $vendorReadme) { Copy-Item -LiteralPath $vendorReadme -Destination $vendorDestino -Force }
} elseif ($vendorCompleto) {
  Escribir-Paso "Copiando vendor/ (puede tardar: son mas de 100 MB)..."
  Copiar-Directorio $vendor $staging
}

# .gitignore no viaja en el ZIP (no se usa en la app ya empaquetada).
# docs/capturas y tests/fixtures se conservan si existen: no ocupan apenas y documentan el proyecto.

Escribir-Ok "Contenido preparado en data\tmp\empaquetar"

# ---------------------------------------------------------------------------
# ZIP (con reintentos: antivirus o programas abiertos pueden bloquear archivos)
# ---------------------------------------------------------------------------
$dist = Split-Path -Parent $zip
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist -Force | Out-Null }

$intentosMax = 3
$zipOk = $false
try {
  for ($intento = 1; $intento -le $intentosMax -and -not $zipOk; $intento++) {
    try {
      if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
      Escribir-Paso "Comprimiendo en $zip (intento $intento/$intentosMax)..."
      Compress-Archive -Path $staging -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop
      if (-not (Test-Path $zip)) {
        throw "Compress-Archive no genero el ZIP esperado."
      }
      $zipOk = $true
    } catch {
      Escribir-Aviso ("El empaquetado fallo: " + $_.Exception.Message)
      if ($intento -lt $intentosMax) {
        Escribir-Paso "Reintentando en 3 segundos (un antivirus o un programa puede tener los archivos en uso)..."
        Start-Sleep -Seconds 3
      }
    }
  }

  if (-not $zipOk) {
    if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
    throw "No se pudo crear el ZIP tras $intentosMax intentos. Cierra la aplicacion, el explorador de archivos y los programas que usen vendor/ y vuelve a intentarlo."
  }

  $tamano = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
  Escribir-Titulo "ZIP generado"
  Write-Host "  Archivo: $zip" -ForegroundColor Green
  Write-Host "  Tamano:  $tamano MB" -ForegroundColor DarkGray
  if ($SinVendor) {
    Escribir-Aviso "Recuerda: este ZIP no incluye vendor/; al abrir Iniciar.bat se ofrecera instalarlo."
  }
} finally {
  # Limpieza del staging para no dejar copias duplicadas de vendor/ (tambien si falla).
  Remove-Item -LiteralPath $stagingBase -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
