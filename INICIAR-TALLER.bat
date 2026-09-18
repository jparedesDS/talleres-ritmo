@echo off
setlocal
title Gestion de citas - Taller
cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo.
echo  Iniciando la gestion de citas del taller...
echo.

set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"

if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%APPDATA%\npm\node.exe" set "NODE=%APPDATA%\npm\node.exe"

if not defined NODE goto sinnode

set TALLER_ABRIR=1

:arrancar
"%NODE%" --no-warnings "server\index.js"
set "CODIGO=%errorlevel%"
rem 0: cerrado con normalidad. 3: puerto ocupado o sin permiso (reintentar no sirve)
if "%CODIGO%"=="0" goto fin
if "%CODIGO%"=="3" goto fin
rem Cualquier otro codigo es un fallo: se vuelve a arrancar solo
goto reiniciar

:reiniciar
set TALLER_ABRIR=0
echo.
echo  El programa se ha detenido por un error. Se vuelve a arrancar en 5 segundos...
echo  (Si no quiere que se reinicie, cierre esta ventana.)
timeout /t 5 /nobreak >nul
goto arrancar

:fin
echo.
echo  El programa se ha cerrado.
pause
exit /b 0

:sinnode
echo  No se ha encontrado Node.js en este equipo.
echo.
echo  Instalelo desde https://nodejs.org (version 22 o superior),
echo  cierre esta ventana y vuelva a intentarlo.
echo.
pause
exit /b 1
