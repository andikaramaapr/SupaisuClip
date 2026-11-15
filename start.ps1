# SupaisuClip — Start Backend + Frontend sekaligus
# Jalankan: .\start.ps1

Write-Host ""
Write-Host "  ✂️  SupaisuClip Studio" -ForegroundColor Cyan
Write-Host "  Starting backend + frontend..." -ForegroundColor Gray
Write-Host ""

# Start backend (FastAPI) di background
$backend = Start-Process -FilePath "E:\SupaisuClip\backend\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--reload", "--port", "8000" `
    -WorkingDirectory "E:\SupaisuClip\backend" `
    -PassThru `
    -NoNewWindow

Write-Host "  [✓] Backend  → http://127.0.0.1:8000  (PID $($backend.Id))" -ForegroundColor Green

Start-Sleep -Seconds 2

Write-Host "  [✓] Frontend → http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "  Tekan Ctrl+C untuk menghentikan keduanya." -ForegroundColor Yellow
Write-Host ""

# Jalankan frontend di foreground (blokir terminal sampai Ctrl+C)
try {
    Set-Location "E:\SupaisuClip\frontend"
    & node_modules\.bin\vite
} finally {
    # Saat Ctrl+C atau vite keluar, matikan backend juga
    Write-Host ""
    Write-Host "  Menghentikan backend (PID $($backend.Id))..." -ForegroundColor Red
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  Semua proses dihentikan." -ForegroundColor Gray
}
