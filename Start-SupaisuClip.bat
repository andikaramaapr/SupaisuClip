@echo off
title SupaisuClip Launcher
color 0A
cls

echo ========================================================
echo          SUPAISUCLIP - AI VIDEO STUDIO LAUNCHER
echo ========================================================
echo.

set "ROOT_DIR=E:\SupaisuClip"
set "PYTHON_EXE=%ROOT_DIR%\backend\.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    color 0C
    echo [ERROR] Python venv tidak ditemukan di %PYTHON_EXE%!
    echo Pastikan virtual environment sudah terinstal di Drive E.
    echo.
    pause
    exit /b 1
)

echo [*] Menjalankan Backend FastAPI (Port 8000)...
start "SupaisuClip-Backend" /min cmd /c "cd /d %ROOT_DIR%\backend && "%PYTHON_EXE%" -m uvicorn main:app --host 127.0.0.1 --port 8000"

echo [*] Menjalankan Frontend Vite (Port 5173)...
start "SupaisuClip-Frontend" /min cmd /c "cd /d %ROOT_DIR%\frontend && npm run dev"

echo [*] Menunggu server siap...
timeout /t 3 /nobreak >nul

echo [*] Membuka browser...
start http://localhost:5173

echo.
echo ========================================================
echo  [OK] SupaisuClip Berhasil Dijalankan!
echo       - Web App : http://localhost:5173
echo       - API Docs: http://localhost:8000/docs
echo.
echo  Untuk mematikan server: klik ganda Stop-SupaisuClip.bat
echo ========================================================
echo.
echo Jendela ini akan tertutup otomatis...
timeout /t 3 >nul
exit
