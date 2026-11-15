@echo off
title Stop SupaisuClip
color 0E
cls

echo ========================================================
echo             MENGHENTIKAN SUPAISUCLIP
echo ========================================================
echo.

echo [*] Menutup server backend (Port 8000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [*] Menutup server frontend (Port 5173)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Tutup window CMD yang diberi judul SupaisuClip
taskkill /FI "WINDOWTITLE eq SupaisuClip-Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SupaisuClip-Frontend*" /F >nul 2>&1

echo.
echo ========================================================
echo  [OK] Seluruh service SupaisuClip berhasil dihentikan.
echo ========================================================
echo.
timeout /t 2 >nul
exit
