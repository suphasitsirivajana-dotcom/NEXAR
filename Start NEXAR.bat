@echo off
chcp 65001 >nul
title NEXAR - local server
cd /d "%~dp0"
echo.
echo   ==========================================
echo     NEXAR is running at http://localhost:5173
echo   ==========================================
echo   Keep this window open while using NEXAR.
echo   Close this window to stop the server.
echo.
start "" cmd /c "ping -n 2 127.0.0.1 >nul & start http://localhost:5173"
python -u -m http.server 5173
if errorlevel 1 py -u -m http.server 5173
pause
