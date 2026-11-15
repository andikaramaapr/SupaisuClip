# SupaisuClip ✂️

**SupaisuClip** adalah platform studio pengeditan video vertikal (9:16) berbasis AI yang dirancang untuk mengonversi video horizontal (YouTube / File Lokal) menjadi klip viral (TikTok, Instagram Reels, YouTube Shorts) secara otomatis dan presisi.

## Fitur Utama
- **AI Clip Finder & Hook Generator**: Menganalisis momen terbaik (30–65 detik) dan membuat teks hook otomatis dengan Google Gemini 3.8 Flash.
- **Smart Framing & Webcam Popout**: Mode Fill-Crop / Blur-BG dengan kontrol drag & magnetic snap untuk webcam popout.
- **Subtitle & Caption Styler**: Styling subtitle presisi (ASS / libass) dengan preset modern, pilihan font kustom, highlight otomatis, dan preview real-time.
- **Sound Effects (SFX) Integrator**: Audio punchy otomatis di awal klip untuk memaksimalkan retensi penonton.
- **Slice-on-Export Engine**: Unduh dan proses hanya segmen waktu yang dibutuhkan tanpa perlu mengunduh seluruh video di awal.

---

## Cara Menjalankan

### Cara Cepat (Windows)
Cukup klik ganda file:
```cmd
Start-SupaisuClip.bat
```
*(Atau gunakan `Create-Desktop-Shortcut.vbs` untuk membuat icon pintasan di Desktop).*

---

### Cara Manual

#### 1. Setup Environment
Salin konfigurasi environment di folder `backend/`:
```bash
cp backend/.env.example backend/.env
```
Isi nilai `GEMINI_API_KEY` Anda di file `backend/.env`.

#### 2. Menjalankan Backend (FastAPI)
```bash
cd backend
# Aktifkan virtual environment
.venv\Scripts\activate
# Jalankan server
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
Akses API Docs di: [http://localhost:8000/docs](http://localhost:8000/docs)

#### 3. Menjalankan Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Akses Web App di: [http://localhost:5173](http://localhost:5173)

---

## Lisensi
MIT License
