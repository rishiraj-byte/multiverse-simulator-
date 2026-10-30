@echo off
setlocal
title Cosmos - building the desktop app
cd /d "%~dp0"
echo.
echo  Building the Cosmos desktop app. This takes 3-8 minutes the first time.
echo  Details go to build-log.txt
echo.
echo [1/4] Installing the app builder...
call npm install --no-audit --no-fund --no-save electron-builder@25.1.8 resedit@2 > build-log.txt 2>&1
if errorlevel 1 goto fail
echo [2/4] Building Cosmos...
call npx vite build >> build-log.txt 2>&1
if errorlevel 1 goto fail
echo [3/4] Packing into a Windows app (downloads Electron once, about 110 MB)...
if exist desktop\dist rmdir /s /q desktop\dist
xcopy /e /i /q /y dist desktop\dist >> build-log.txt 2>&1
if exist release rmdir /s /q release
call npx electron-builder --win nsis --x64 --publish never --config electron-builder.json >> build-log.txt 2>&1
if errorlevel 1 goto fail
set SETUP=
for %%f in (release\Cosmos-Setup-*.exe) do set SETUP=%%f
if not defined SETUP goto fail
echo [4/4] Done: %SETUP%
echo.
echo  Starting the installer - Cosmos will appear on your Desktop and in the Start menu.
start "" "%SETUP%"
echo BUILD OK>> build-log.txt
goto end
:fail
echo.
echo  BUILD FAILED - open build-log.txt to see why.
echo BUILD FAILED>> build-log.txt
:end
pause
