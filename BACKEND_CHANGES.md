# SupaisuClip — Backend Changes & Status

> Audit date: 2026-11-15. Backend is **complete — no rewrites required**.

---

## Backend Status

| Item | Status |
|------|--------|
| `main.py` (789 lines) | ✅ Complete |
| `srt_utils.py` | ✅ Complete |
| `subtitle_engine.py` | ✅ Complete |
| `video_engine.py` | ✅ Complete |
| `youtube_engine.py` | ✅ Complete |
| `/api/health` smoke test | ✅ PASSED |
| Project pytest tests | ✅ 39 PASSED (`backend/tests`) |

**No backend files need to be rewritten.** The implementation is fully functional.

---

## Bugs Found (do NOT fix without coordinator approval)

### BUG-8/12 (CRITICAL): Legacy `/api/render` does not catch `ValidationError`
- Path: `POST /api/render`
- When `webcam_enabled=True` and `webcam_src_json="{}"` (empty/invalid Rect), Pydantic raises `ValidationError`.
- The except block only catches `ValueError` and `json.JSONDecodeError` — `ValidationError` escapes as HTTP 500.
- **Fix candidate:** Add `from pydantic import ValidationError` to the except clause, or deprecate the endpoint.

### BUG-3 (LOW): `clip_end` not validated against `video_duration` at Pydantic layer
- `RenderParams` validator allows any `clip_end > clip_start`. Values above video duration are silently clamped in `resolve_clip()`.
- Not a security issue; just confusing for API callers.

### BUG-1 (MEDIUM): Legacy `/api/render` exposes only a subset of `RenderParams`
- Missing: `srt_relative`, `clip_start`, `clip_end`, `main_y_offset`, `main_zoom`, `webcam_style`, `hook_font_size`, `hook_color`, `hook_box_color`, `hook_mode`, `highlight_words`, `highlight_color`, `sfx_start_sec`, `resolution`, `fps`, `crf`, `encoder`, `preview_seconds`.
- Also has hardcoded defaults different from `RenderParams` (e.g., `font_size=64`, `subtitle_margin_v=340`).
- **Recommendation:** Direct all frontend render calls to `POST /api/render/start` instead.

---

## curl Examples for Each Major Endpoint

### Health check
```bash
curl http://localhost:8000/api/health
```

### List assets (styles, fonts, sfx)
```bash
curl http://localhost:8000/api/assets
```

### List available encoders
```bash
curl http://localhost:8000/api/system/encoders
```

### Upload video + SRT
```bash
curl -X POST http://localhost:8000/api/upload/project \
  -F "video=@clip.mp4" \
  -F "srt=@subtitles.srt"
```

### Upload SRT only
```bash
curl -X POST http://localhost:8000/api/upload/srt \
  -F "srt=@subtitles.srt"
```

### Upload custom font
```bash
curl -X POST http://localhost:8000/api/upload/font \
  -F "font=@MyFont.ttf"
```

### Upload SFX
```bash
curl -X POST http://localhost:8000/api/upload/sfx \
  -F "sfx=@intro.wav"
```

### Validate SRT text
```bash
curl -X POST http://localhost:8000/api/srt/validate \
  -H "Content-Type: application/json" \
  -d '{"srt_text": "1\n00:00:00,000 --> 00:00:02,000\nHello world\n"}'
```

### Create proxy for HEVC/ProRes video
```bash
curl -X POST http://localhost:8000/api/video/proxy \
  -H "Content-Type: application/json" \
  -d '{"video_filename": "abc123.mp4"}'
```

### YouTube info (no download)
```bash
curl -X POST http://localhost:8000/api/youtube/info \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=VIDEOID"}'
```

### YouTube download (async)
```bash
curl -X POST http://localhost:8000/api/youtube/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=VIDEOID", "sub_lang": "id", "sub_source": "auto"}'
# Returns: {"job_id": "abc123"}

# Poll status:
curl http://localhost:8000/api/youtube/status/abc123
```

### Fetch YouTube subtitles separately
```bash
curl -X POST http://localhost:8000/api/youtube/subtitles \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=VIDEOID", "job_id": "abc123", "lang": "id", "source": "auto"}'
```

### AI: Generate hooks
```bash
curl -X POST http://localhost:8000/api/ai/generate-hooks \
  -H "Content-Type: application/json" \
  -d '{"srt_text": "1\n00:00:00,000 --> 00:00:05,000\nThis is my story\n", "language": "Indonesian", "clip_start": 0, "clip_end": 60}'
```

### AI: Analyze clips
```bash
curl -X POST http://localhost:8000/api/ai/analyze-clips \
  -H "Content-Type: application/json" \
  -d '{"srt_text": "...", "video_duration": 600.0, "language": "Indonesian"}'
```

### AI: Generate metadata
```bash
curl -X POST http://localhost:8000/api/ai/metadata \
  -H "Content-Type: application/json" \
  -d '{"srt_text": "...", "platform": "TikTok", "language": "Indonesian"}'
```

### AI: Suggest highlight words
```bash
curl -X POST http://localhost:8000/api/ai/highlight-words \
  -H "Content-Type: application/json" \
  -d '{"srt_text": "..."}'
```

### AI: Suggest subtitle style
```bash
curl -X POST http://localhost:8000/api/ai/suggest-style \
  -H "Content-Type: application/json" \
  -d '{"srt_text": "..."}'
```

### Preview ASS for JASSUB (absolute_time=false for clipped player)
```bash
curl -X POST http://localhost:8000/api/preview/ass \
  -H "Content-Type: application/json" \
  -d '{
    "video_filename": "abc123.mp4",
    "srt_text": "1\n00:00:00,000 --> 00:00:03,000\nHello\n",
    "clip_start": 10.0,
    "clip_end": 70.0,
    "style_key": "hormozi_pop",
    "font_family": "Arial",
    "hook_text": "Watch this!",
    "absolute_time": false
  }'
```

### Start async render
```bash
curl -X POST http://localhost:8000/api/render/start \
  -H "Content-Type: application/json" \
  -d '{
    "video_filename": "abc123.mp4",
    "srt_text": "1\n00:00:00,000 --> 00:00:03,000\nHello\n",
    "clip_start": 10.0,
    "clip_end": 70.0,
    "style_key": "hormozi_pop",
    "font_family": "Arial",
    "hook_text": "Watch this!",
    "hook_duration_sec": 3.0,
    "layout_mode": "fill_crop",
    "resolution": 1080,
    "encoder": "auto"
  }'
# Returns: {"job_id": "xyz789"}

# Poll render status:
curl http://localhost:8000/api/render/status/xyz789
```

### Preview render (10 seconds, fast)
```bash
curl -X POST http://localhost:8000/api/render/start \
  -H "Content-Type: application/json" \
  -d '{
    "video_filename": "abc123.mp4",
    "clip_start": 10.0,
    "clip_end": 70.0,
    "style_key": "hormozi_pop",
    "preview_seconds": 10
  }'
```


---

### Update 2026-11-15: Gemini Model Deprecation Fix
- Google mendeprekasi model `models/gemini-2.5-flash` untuk pengguna baru (Error 404 NOT_FOUND).
- `backend/main.py`: `gemini_json()` diperbarui menggunakan default `gemini-3.8-flash` dengan automatic fallback list: `["gemini-3.8-flash", "gemini-2.0-flash", "gemini-1.5-flash"]` jika terjadi error 404 / NOT_FOUND / not available.
- `backend/.env`: Ditambahkan `GEMINI_MODEL=gemini-3.8-flash`.


---

### Update 2026-11-15: Online YouTube Preview & Slice-on-Export + Subtitle Styler Redesign
- `backend/youtube_engine.py`:
  - Ditambahkan fungsi `download_youtube_clip(url: str, output_path: Path, start_sec: float, end_sec: float) -> Path` menggunakan `yt-dlp --download-sections "*start-end"` untuk mengunduh hanya potongan video klip yang dipilih secara cepat saat export.
- `backend/subtitle_engine.py`:
  - Ditambahkan 8 preset subtitle baru di `SUBTITLE_STYLES`: `viral_pop`, `beast_punch`, `cyber_violet`, `fire_crimson`, `electric_cyan`, `golden_aura`, `clean_minimal`, dan `none` (dengan tetap mempertahankan alias lama).
  - Jika `style_key == "none"`, subtitle `MainSub` tidak dibakar ke dalam file ASS.
  - Ditambahkan dukungan parameter `letter_style: Literal["uppercase", "title", "lowercase"] = "uppercase"` pada `build_ass_text()`.
- `backend/main.py`:
  - `RenderParams`: Ditambahkan `youtube_url: str = ""` dan `letter_style: Literal["uppercase", "title", "lowercase"] = "uppercase"`, serta `video_filename: str = ""` opsional jika `youtube_url` terisi.
  - `execute_render()`: Jika `video_filename` kosong tapi `youtube_url` terisi, mengunduh hanya potongan klip `clip_start` s/d `clip_end` lewat `youtube_engine.download_youtube_clip()`, lalu merender FFmpeg dengan `clip_start=0`.
  - `preview_ass()`: Mendukung preview ASS saat video lokal belum diunduh (menggunakan durasi virtual dari YouTube).


---

### Update 2026-11-15: Multi-Model Resilient Fallback (503 / 429 / 404 Handling)
- `backend/main.py`: `gemini_json()` diperbarui dengan rantai fallback cerdas:
  `["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"]`.
- Jika sebuah model mengembalikan status **503 UNAVAILABLE** (high demand), **429 RESOURCE_EXHAUSTED** (rate limit/quota), **404 NOT_FOUND** (deprecated), atau timeout, backend tidak akan error ke user, melainkan otomatis beralih dan mencoba model berikutnya secara seamless.
