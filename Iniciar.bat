@echo off
chcp 65001 >nul
title Instructor de Logistica
cd /d "%~dp0"

echo.
echo  ===============================================
echo    INSTRUCTOR DE LOGISTICA
echo    Evaluador de entregas con retroalimentacion
echo  ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] No se encontro Node.js.
  echo.
  echo  Instala Node.js 20 o superior desde https://nodejs.org
  echo  y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

rem Comprueba que las dependencias binarias (no incluidas en el repositorio) esten instaladas.
set "VENDOR_OK=1"
if not exist "vendor\pdfjs-dist\legacy\build\pdf.mjs" set "VENDOR_OK="
if not exist "vendor\node_modules\@napi-rs\canvas" set "VENDOR_OK="
if not exist "vendor\node_modules\@napi-rs\canvas-win32-x64-msvc" set "VENDOR_OK="
if not exist "vendor\bin\ffmpeg.exe" set "VENDOR_OK="

if defined VENDOR_OK goto :vendor_listo

echo  Faltan los componentes de la carpeta "vendor".
echo  Se instalaran automaticamente ahora.
echo.
echo  Requiere conexion a internet y puede tardar unos minutos
echo  la primera vez (descarga de PDF.js, canvas y FFmpeg).
echo.
call :preparar_vendor
if errorlevel 1 goto :error_vendor

set "VENDOR_OK=1"
if not exist "vendor\pdfjs-dist\legacy\build\pdf.mjs" set "VENDOR_OK="
if not exist "vendor\node_modules\@napi-rs\canvas" set "VENDOR_OK="
if not exist "vendor\node_modules\@napi-rs\canvas-win32-x64-msvc" set "VENDOR_OK="
if not exist "vendor\bin\ffmpeg.exe" set "VENDOR_OK="
if not defined VENDOR_OK goto :error_vendor

:vendor_listo
echo  Iniciando la aplicacion...
echo.
echo  IMPORTANTE: NO cierres esta ventana mientras uses la aplicacion.
echo  Si la cierras, el navegador mostrara "Failed to fetch" al evaluar.
echo.
echo  El navegador se abrira automaticamente.
echo  Para cerrar la aplicacion presiona Ctrl + C en esta ventana.
echo.

node "lib\server.js" --open

echo.
echo  La aplicacion se detuvo.
pause
exit /b 0

:preparar_vendor
where powershell >nul 2>nul
if errorlevel 1 goto :preparar_vendor_full
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\preparar-vendor.ps1"
exit /b %errorlevel%

:preparar_vendor_full
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "tools\preparar-vendor.ps1"
exit /b %errorlevel%

:error_vendor
echo.
echo  [ERROR] No se pudieron instalar los componentes de "vendor".
echo.
echo  Revisa la conexion a internet y vuelve a intentarlo.
echo  Tambien puedes ejecutar manualmente, desde esta carpeta:
echo.
echo    powershell -NoProfile -ExecutionPolicy Bypass -File tools\preparar-vendor.ps1
echo.
pause
exit /b 1
