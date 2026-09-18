@echo off
setlocal
title Datos de ejemplo - Taller
cd /d "%~dp0"
chcp 65001 >nul 2>nul

set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE goto sinnode

echo.
echo   DATOS DE EJEMPLO
echo   ----------------
echo   Sirven para ver el programa con contenido: 3 clientes,
echo   4 vehiculos y 15 citas repartidas entre estas semanas.
echo.
echo   1. Anadir los datos de ejemplo
echo   2. Borrar los datos de ejemplo
echo   3. Salir sin hacer nada
echo.

choice /c 123 /n /m "  Elija una opcion (1, 2 o 3): "
if errorlevel 3 goto fin
if errorlevel 2 goto borrar

echo.
"%NODE%" --no-warnings "herramientas\ejemplo.js"
goto fin

:borrar
echo.
"%NODE%" --no-warnings "herramientas\ejemplo.js" --borrar
goto fin

:sinnode
echo   No se ha encontrado Node.js en este equipo.

:fin
echo.
echo   Si el programa estaba abierto, actualice el navegador con F5.
echo.
pause
