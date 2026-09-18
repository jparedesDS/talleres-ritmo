@echo off
setlocal
title Datos de demostracion - Taller
cd /d "%~dp0"
chcp 65001 >nul 2>nul

set "NODE="
where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE goto sinnode

echo.
echo   DATOS DE DEMOSTRACION
echo   ---------------------
echo   Instala una base de datos de prueba (4 clientes, 5 vehiculos
echo   y 16 citas, todo inventado) y coloca las citas en la semana
echo   actual para poder ver el programa funcionando.
echo.
echo   Si ya tiene datos propios NO se tocan: el programa avisara.
echo.

choice /c SN /n /m "  Continuar? (S/N): "
if errorlevel 2 goto fin

echo.
"%NODE%" --no-warnings "herramientas\usar-demo.js"
goto fin

:sinnode
echo   No se ha encontrado Node.js en este equipo.

:fin
echo.
echo   Si el programa estaba abierto, cierrelo y vuelva a abrirlo.
echo.
pause
