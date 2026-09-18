@echo off
setlocal
title Actualizar el programa del taller
cd /d "%~dp0"
chcp 65001 >nul 2>nul

set "ORIGEN=%~dp0"
if "%ORIGEN:~-1%"=="\" set "ORIGEN=%ORIGEN:~0,-1%"

echo.
echo   ACTUALIZAR EL PROGRAMA DEL TALLER
echo   =================================
echo.
echo   Version nueva (esta carpeta):
echo     %ORIGEN%
echo.
echo   IMPORTANTE: cierre antes el programa en el equipo servidor
echo   (la ventana negra de INICIAR-TALLER). Los datos NO se tocan.
echo.

if not exist "%ORIGEN%\server\index.js" goto sinprograma

rem Se puede pasar la carpeta como parametro, y /S para no preguntar:
rem     ACTUALIZAR.bat "D:\TALLER"
rem     ACTUALIZAR.bat "D:\TALLER" /S
set "DESTINO=%~1"
set "SINPREGUNTAS="
if /i "%~2"=="/S" set "SINPREGUNTAS=1"
if not defined DESTINO set /p "DESTINO=  Carpeta donde esta instalado (Enter para cancelar): "
if not defined DESTINO goto cancelado
if "%DESTINO:~-1%"=="\" set "DESTINO=%DESTINO:~0,-1%"

if /i "%ORIGEN%"=="%DESTINO%" goto mismacarpeta
if not exist "%DESTINO%\server\index.js" goto noinstalado

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd-HHmm"') do set "SELLO=%%i"
if not defined SELLO set "SELLO=copia"
set "RESGUARDO=%DESTINO%\..\copia-datos-taller-%SELLO%"

echo.
echo   Se va a hacer esto:
echo     1. Guardar una copia de los datos en:
echo        %RESGUARDO%
echo     2. Sustituir el programa por el de esta carpeta.
echo     3. La carpeta "datos" del taller se queda como esta.
echo.
if defined SINPREGUNTAS goto adelante
choice /c SN /n /m "  Continuar? (S/N): "
if errorlevel 2 goto cancelado
:adelante

echo.
echo   [1/2] Guardando copia de los datos...
robocopy "%DESTINO%\datos" "%RESGUARDO%" /E /R:2 /W:2 /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto fallocopia

echo   [2/2] Copiando la version nueva...
robocopy "%ORIGEN%" "%DESTINO%" /E /R:2 /W:2 /NFL /NDL /NJH /NJS /XD datos .git demo /XF *.db *.db-wal *.db-shm DATOS-DE-DEMOSTRACION.bat >nul
if errorlevel 8 goto falloprograma

echo.
echo   ---------------------------------------------------------
echo   LISTO. El programa esta actualizado y los datos intactos.
echo.
echo   Abra INICIAR-TALLER.bat en el equipo servidor.
echo   Si algo va mal, los datos de antes estan en:
echo     %RESGUARDO%
echo   ---------------------------------------------------------
goto fin

:sinprograma
echo   ERROR: esta carpeta no contiene el programa (falta server\index.js).
echo   Ejecute este archivo desde la carpeta de la VERSION NUEVA.
goto fin

:noinstalado
echo.
echo   ERROR: en "%DESTINO%" no hay ningun programa instalado.
echo   Compruebe la ruta: tiene que ser la carpeta que contiene
echo   INICIAR-TALLER.bat y la carpeta "datos".
goto fin

:mismacarpeta
echo.
echo   ERROR: ha indicado esta misma carpeta.
echo   El origen y el destino tienen que ser distintos.
goto fin

:fallocopia
echo.
echo   ERROR: no se pudo guardar la copia de los datos.
echo   NO se ha tocado nada. Compruebe permisos y espacio en disco.
goto fin

:falloprograma
echo.
echo   ERROR: la copia del programa fallo a medias.
echo   Los datos siguen intactos y hay un resguardo en:
echo     %RESGUARDO%
goto fin

:cancelado
echo.
echo   Cancelado. No se ha cambiado nada.

:fin
echo.
pause
