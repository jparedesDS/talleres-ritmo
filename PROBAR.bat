@echo off
setlocal
title Pruebas del programa - Taller
cd /d "%~dp0"
chcp 65001 >nul 2>nul

set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE goto sinnode

echo.
echo   Comprobando que todo el programa funciona...
echo   (se usa una base de datos de prueba; la real no se toca)
echo.

"%NODE%" --no-warnings "herramientas\pruebas.js"
set "CODIGO=%errorlevel%"

if "%CODIGO%"=="0" goto fin
echo.
echo   ATENCION: algo no funciona. NO instale esta version en el taller
echo   hasta arreglar lo que aparece arriba.
goto fin

:sinnode
echo   No se ha encontrado Node.js en este equipo.

:fin
echo.
pause
