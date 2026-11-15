# SupaisuClip Project Rules (Strict Drive E Isolation)
- ALL dependencies, caches, temp files, uploads, and outputs MUST stay inside E:\SupaisuClip. NEVER write caches or temp files to Drive C.
- Python interpreter: ALWAYS use E:\SupaisuClip\backend\.venv\Scripts\python.exe.
- Node/NPM: ALWAYS run inside E:\SupaisuClip\frontend where .npmrc locks cache to E:\SupaisuClip\.cache\npm.
- Architecture:
  - ackend/: FastAPI (port 8000), FFmpeg video/audio compositor (libass for subtitles), google-genai SDK for AI hook generation.
  - rontend/: React + Vite + Tailwind CSS visual canvas editor (9:16 preview, drag/resize webcam crop & overlay, custom font uploader, subtitle style selector, hook & SFX timeline).
  - workspace/: Runtime storage (uploads/, onts/, sfx/, exports/).
