import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, model_validator

import youtube_engine
from srt_utils import parse_srt, slice_srt, snap_to_cues, to_srt, transcript_for_ai, validate_srt
from subtitle_engine import SUBTITLE_STYLES, build_ass_text, get_font_family_name, slice_srt_to_zero
from video_engine import (
    DEFAULT_WEBCAM_STYLE,
    detect_encoders,
    ensure_default_sfx,
    ensure_preview_proxy,
    probe_video,
    render_vertical_clip,
)

# --------------------------------------------------------------- setup -----
ROOT_DIR = Path(os.getenv("SUPAISU_ROOT") or Path(__file__).resolve().parent.parent)
WORKSPACE = ROOT_DIR / "workspace"
UPLOADS_DIR = WORKSPACE / "uploads"
FONTS_DIR = WORKSPACE / "fonts"
SFX_DIR = WORKSPACE / "sfx"
EXPORTS_DIR = WORKSPACE / "exports"
for _d in (UPLOADS_DIR, FONTS_DIR, SFX_DIR, EXPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

load_dotenv(ROOT_DIR / "backend" / ".env")
ensure_default_sfx(SFX_DIR)

app = FastAPI(title="SupaisuClip API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/files/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/files/fonts", StaticFiles(directory=str(FONTS_DIR)), name="fonts")
app.mount("/files/sfx", StaticFiles(directory=str(SFX_DIR)), name="sfx")
app.mount("/files/exports", StaticFiles(directory=str(EXPORTS_DIR)), name="exports")

VIDEO_UPLOAD_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
JOB_ID_RE = re.compile(r"^[a-f0-9]{8,12}$")


# ------------------------------------------------------------- helpers -----
def safe_child(base: Path, name: str, what: str = "File") -> Path:
    """Path anak di dalam `base`. Tolak '..', separator, dan path absolut."""
    if not name or "/" in name or "\\" in name or Path(name).name != name or name in (".", ".."):
        raise HTTPException(400, f"Nama {what.lower()} tidak valid")
    target = (base / name).resolve()
    if base.resolve() not in target.parents:
        raise HTTPException(400, f"Nama {what.lower()} tidak valid")
    return target


_probe_cache: dict[tuple[str, float], dict] = {}


def probe_cached(path: Path) -> dict:
    try:
        key = (str(path), path.stat().st_mtime)
    except FileNotFoundError:
        raise HTTPException(404, "File video tidak ditemukan")
    if key not in _probe_cache:
        try:
            _probe_cache[key] = probe_video(path)
        except RuntimeError as e:
            raise HTTPException(400, str(e))
    return _probe_cache[key]


def decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def save_upload(upload: UploadFile, target: Path) -> None:
    with target.open("wb") as buf:
        shutil.copyfileobj(upload.file, buf)


def meta_payload(meta: dict) -> dict:
    return {**meta, "orientation": "landscape" if meta["width"] >= meta["height"] else "portrait"}


# ------------------------------------------------------ model parameter -----
class Rect(BaseModel):
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class WebcamStyle(BaseModel):
    border_px: int = Field(DEFAULT_WEBCAM_STYLE["border_px"], ge=0, le=40)
    border_color: str = DEFAULT_WEBCAM_STYLE["border_color"]
    radius_px: int = Field(DEFAULT_WEBCAM_STYLE["radius_px"], ge=0, le=400)


class CameraKeyframe(BaseModel):
    id: str = ""
    time: float = Field(0.0, ge=0)
    x_offset: float = Field(0.5, ge=0, le=1)
    y_offset: float = Field(0.5, ge=0, le=1)
    zoom: float = Field(1.0, ge=1.0, le=4.0)
    easing: Literal["smooth", "hold"] = "smooth"


class RenderParams(BaseModel):
    """SATU sumber kebenaran untuk render DAN preview ASS. Frontend EditState harus identik dengan ini."""
    video_filename: str = ""
    youtube_url: str = ""                 # Jika video_filename kosong, unduh potongan YouTube saat export
    # --- segmen & subtitle ---
    srt_text: str = ""
    srt_relative: bool = False            # True: srt_text sudah relatif klip (mulai 0)
    clip_start: float = Field(0.0, ge=0)
    clip_end: float | None = Field(None, gt=0)
    style_key: str = "viral_pop"
    font_family: str = "Arial"
    font_size: int | None = Field(None, ge=16, le=200)
    primary_color: str | None = None
    outline_color: str | None = None
    subtitle_margin_v: int | None = Field(None, ge=0, le=1800)
    highlight_words: list[str] = Field(default_factory=list, max_length=200)
    highlight_color: str = "#FF3B3B"
    letter_style: Literal["uppercase", "title", "lowercase"] = "uppercase"
    subtitle_style: str | None = None
    subtitle_position: int | None = None
    cues: list[dict] = Field(default_factory=list)
    # --- hook ---
    hook_text: str = ""
    hook_duration_sec: float = Field(3.0, ge=0)   # 0 = seluruh klip
    hook_y_margin: int = Field(180, ge=0, le=1800)
    hook_font_size: int = Field(74, ge=16, le=200)
    hook_font_family: str = ""
    hook_color: str = "#FFFFFF"
    hook_box_color: str = "#121212"
    hook_mode: Literal["box", "text", "clean"] = "box"
    hook_animation: Literal["pop_bounce", "zoom_slam", "fade_slide_up", "typewriter_fade", "none"] = "pop_bounce"
    hook_letter_style: Literal["uppercase", "title", "lowercase"] = "uppercase"
    # --- layout video ---
    layout_mode: Literal["fill_crop", "blur_bg"] = "fill_crop"
    main_x_offset: float = Field(0.5, ge=0, le=1)
    main_y_offset: float = Field(0.5, ge=0, le=1)
    main_zoom: float = Field(1.0, ge=1.0, le=4.0)
    camera_keyframes: list[CameraKeyframe] = Field(default_factory=list)
    webcam_enabled: bool = False
    webcam_src: Rect | None = None        # rasio 0-1 terhadap video sumber
    webcam_dst: Rect | None = None        # piksel canvas 1080x1920 (kotak luar, termasuk border)
    webcam_style: WebcamStyle = Field(default_factory=WebcamStyle)
    # --- SFX ---
    sfx_filename: str = ""
    sfx_volume: float = Field(0.85, ge=0, le=3)
    sfx_start_sec: float = Field(0.0, ge=0)
    # --- output ---
    resolution: Literal[1080, 720] = 1080
    fps: int | None = Field(None, ge=15, le=60)
    crf: int = Field(20, ge=14, le=35)
    encoder: str = "auto"
    preview_seconds: float | None = Field(None, gt=0, le=30)
    # --- subtitle animation ---
    subtitle_animation: Literal[
        "none",
        "word_bounce",
        "karaoke_spotlight",
        "spring_pop",
        "blur_reveal",
        "impact_slam",
        "neon_glow",
        # legacy aliases
        "pop_in",
        "fade_up",
        "zoom_soft",
    ] = "word_bounce"
    # --- subtitle sync ---
    subtitle_offset_sec: float = Field(0.0, ge=-30.0, le=30.0)
    word_timings: list[dict] = Field(default_factory=list)  # [{word, start, end}] dari YouTube VTT

    @model_validator(mode="after")
    def _check(self):
        if not self.video_filename and not self.youtube_url:
            raise ValueError("Harus mengisi salah satu dari video_filename atau youtube_url")
        if self.webcam_enabled and not (self.webcam_src and self.webcam_dst):
            raise ValueError("webcam_enabled=true butuh webcam_src dan webcam_dst")
        if self.clip_end is not None and self.clip_end <= self.clip_start:
            raise ValueError("clip_end harus lebih besar dari clip_start")
        # Pastikan style_key tidak kosong/"none" jika ada subtitle
        if not self.style_key or self.style_key.strip().lower() == "none":
            self.style_key = "viral_pop"
        if self.subtitle_position is not None and self.subtitle_margin_v is None:
            self.subtitle_margin_v = self.subtitle_position
        return self


class PreviewAssRequest(RenderParams):
    absolute_time: bool = False   # True: event digeser +clip_start agar cocok dengan timeline video penuh


def resolve_clip(p: RenderParams, meta: dict) -> tuple[float, float]:
    ce = min(p.clip_end if p.clip_end is not None else meta["duration"], meta["duration"])
    if p.clip_start >= meta["duration"] or ce - p.clip_start < 0.5:
        raise HTTPException(
            400, f"Rentang klip tidak valid: {p.clip_start:.1f}s-{ce:.1f}s (durasi video {meta['duration']:.1f}s)"
        )
    return p.clip_start, ce


def ass_from_params(p: RenderParams, meta: dict, time_shift: float = 0.0) -> str:
    cs, ce = resolve_clip(p, meta)
    return build_ass_text(
        p.srt_text,
        style_key=p.style_key,
        font_family=p.font_family,
        font_size=p.font_size,
        primary_color=p.primary_color,
        outline_color=p.outline_color,
        margin_v=p.subtitle_margin_v,
        hook_text=p.hook_text,
        hook_duration_sec=p.hook_duration_sec,
        hook_y_margin=p.hook_y_margin,
        hook_font_size=p.hook_font_size,
        hook_font_family=p.hook_font_family,
        hook_color=p.hook_color,
        hook_box_color=p.hook_box_color,
        hook_mode=p.hook_mode,
        hook_animation=p.hook_animation,
        highlight_words=p.highlight_words,
        highlight_color=p.highlight_color,
        letter_style=p.letter_style,
        hook_letter_style=getattr(p, 'hook_letter_style', 'uppercase'),
        subtitle_animation=getattr(p, 'subtitle_animation', 'word_bounce'),
        clip_start=cs,
        clip_end=ce,
        srt_relative=p.srt_relative,
        clip_duration_sec=ce - cs,
        time_shift=time_shift,
        subtitle_offset_sec=getattr(p, 'subtitle_offset_sec', 0.0),
        word_timings=getattr(p, 'word_timings', []),
    )


# ------------------------------------------------------------- dasar -------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "root": str(ROOT_DIR),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe")),
        "gemini_key": bool(os.getenv("GEMINI_API_KEY", "").strip() not in ("", "ISI_API_KEY_GEMINI_KAMU")),
        "gemini_model": os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
    }


@app.get("/api/assets")
def list_assets():
    fonts = [
        {"filename": f.name, "family": get_font_family_name(f), "url": f"/files/fonts/{f.name}"}
        for f in sorted(FONTS_DIR.glob("*")) if f.suffix.lower() in (".ttf", ".otf")
    ]
    sfx = [
        {"filename": f.name, "url": f"/files/sfx/{f.name}"}
        for f in sorted(SFX_DIR.glob("*")) if f.suffix.lower() in (".wav", ".mp3", ".ogg")
    ]
    return {"styles": SUBTITLE_STYLES, "fonts": fonts, "sfx": sfx}


@app.get("/api/system/encoders")
def system_encoders():
    try:
        return detect_encoders()
    except RuntimeError as e:
        raise HTTPException(500, str(e))


# ------------------------------------------------------------ upload -------
@app.post("/api/upload/project")
def upload_project(video: UploadFile = File(...), srt: UploadFile | None = File(None)):
    ext = Path(video.filename or "clip.mp4").suffix.lower() or ".mp4"
    if ext not in VIDEO_UPLOAD_EXTS:
        raise HTTPException(400, f"Format video harus salah satu dari: {', '.join(sorted(VIDEO_UPLOAD_EXTS))}")
    job_id = uuid.uuid4().hex[:10]
    vid_name = f"{job_id}{ext}"
    vid_path = UPLOADS_DIR / vid_name
    save_upload(video, vid_path)
    try:
        meta = probe_video(vid_path)
    except RuntimeError as e:
        vid_path.unlink(missing_ok=True)
        raise HTTPException(400, str(e))
    srt_text = decode_text(srt.file.read()) if srt else ""
    return {
        "job_id": job_id,
        "video_filename": vid_name,
        "video_url": f"/files/uploads/{vid_name}",
        "meta": meta_payload(meta),
        "srt_text": srt_text,
        "srt_source": "upload" if srt_text else "none",
    }


@app.post("/api/upload/srt")
def upload_srt(srt: UploadFile = File(...)):
    text = decode_text(srt.file.read())
    problems = validate_srt(text)
    return {"srt_text": text, "cue_count": len(parse_srt(text)), "problems": problems}


@app.post("/api/upload/font")
def upload_font(font: UploadFile = File(...)):
    ext = Path(font.filename or "").suffix.lower()
    if ext not in (".ttf", ".otf"):
        raise HTTPException(400, "Format font harus .ttf atau .otf")
    safe_name = Path(font.filename).name.replace(" ", "_")
    target = safe_child(FONTS_DIR, safe_name, "font")
    save_upload(font, target)
    return {"filename": safe_name, "family": get_font_family_name(target), "url": f"/files/fonts/{safe_name}"}


@app.post("/api/upload/sfx")
def upload_sfx(sfx: UploadFile = File(...)):
    ext = Path(sfx.filename or "").suffix.lower()
    if ext not in (".wav", ".mp3", ".ogg"):
        raise HTTPException(400, "Format SFX harus .wav, .mp3, atau .ogg")
    safe_name = Path(sfx.filename).name.replace(" ", "_")
    target = safe_child(SFX_DIR, safe_name, "SFX")
    save_upload(sfx, target)
    return {"filename": safe_name, "url": f"/files/sfx/{safe_name}"}


class SrtReq(BaseModel):
    srt_text: str


@app.post("/api/srt/validate")
def srt_validate(req: SrtReq):
    return {"cue_count": len(parse_srt(req.srt_text)), "problems": validate_srt(req.srt_text)}


@app.post("/api/srt/parse")
def srt_parse(req: SrtReq):
    return {"entries": parse_srt(req.srt_text), "problems": validate_srt(req.srt_text)}


class ProxyReq(BaseModel):
    video_filename: str


@app.post("/api/video/proxy")
def video_proxy(req: ProxyReq):
    """Video HEVC/ProRes/10-bit tidak bisa diputar Chrome: buat proxy H.264 720p (preview saja)."""
    path = safe_child(UPLOADS_DIR, req.video_filename, "video")
    meta = probe_cached(path)
    if not meta["needs_proxy"]:
        return {"preview_url": f"/files/uploads/{path.name}", "is_proxy": False}
    proxy = UPLOADS_DIR / f"{path.stem}_proxy.mp4"
    try:
        ensure_preview_proxy(path, proxy)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return {"preview_url": f"/files/uploads/{proxy.name}", "is_proxy": True}


# ----------------------------------------------------------- YouTube -------
class YtInfoReq(BaseModel):
    url: str


class YtDownloadReq(BaseModel):
    url: str
    sub_lang: str = ""
    sub_source: Literal["manual", "auto", "none"] = "none"


class YtSubsReq(BaseModel):
    url: str
    job_id: str = ""
    lang: str
    source: Literal["manual", "auto"]


class YtFrameReq(BaseModel):
    url: str
    timestamp_sec: float = 0.0


@app.post("/api/youtube/info")
def youtube_info(req: YtInfoReq):
    try:
        info = youtube_engine.fetch_info(req.url)
        srt_text = ""
        srt_source = "none"
        default_sub = info.get("default_sub")
        if default_sub and default_sub.get("lang") and default_sub.get("source"):
            temp_id = uuid.uuid4().hex[:10]
            try:
                srt_text = youtube_engine.fetch_subtitles(
                    req.url, UPLOADS_DIR, temp_id, default_sub["lang"], default_sub["source"]
                )
                srt_source = default_sub["source"]
            except Exception:
                pass
        return {**info, "srt_text": srt_text, "srt_source": srt_source}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.post("/api/youtube/download")
def youtube_download(req: YtDownloadReq):
    job_id = uuid.uuid4().hex[:10]
    try:
        youtube_engine.start_download(req.url, job_id, UPLOADS_DIR, req.sub_lang, req.sub_source)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"job_id": job_id}


@app.get("/api/youtube/status/{job_id}")
def youtube_status(job_id: str):
    job = youtube_engine.JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")
    if job["status"] == "done" and "meta" not in job:
        vid = UPLOADS_DIR / job["video_filename"]
        try:
            job["meta"] = meta_payload(probe_video(vid))
            job["video_url"] = f"/files/uploads/{vid.name}"
        except RuntimeError as e:
            job.update(status="error", error=str(e))
    return {"job_id": job_id, **job}


@app.post("/api/youtube/subtitles")
def youtube_subtitles(req: YtSubsReq):
    sub_job_id = req.job_id if (req.job_id and JOB_ID_RE.match(req.job_id)) else uuid.uuid4().hex[:10]
    try:
        text = youtube_engine.fetch_subtitles(req.url, UPLOADS_DIR, sub_job_id, req.lang, req.source)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"srt_text": text, "srt_source": req.source}


@app.post("/api/youtube/frame")
def youtube_frame(req: YtFrameReq):
    try:
        frame_url = youtube_engine.extract_youtube_frame(req.url, req.timestamp_sec, UPLOADS_DIR)
        return {"frame_url": frame_url}
    except Exception as e:
        raise HTTPException(500, f"Gagal mengambil frame video: {e}")


# --------------------------------------------------------------- AI --------
class HookOut(BaseModel):
    hook: str
    recommended_seconds: int
    reason: str


class HookList(BaseModel):
    hooks: list[HookOut]


class ClipOut(BaseModel):
    start: float
    end: float
    title: str
    virality_score: int
    reason: str
    suggested_hooks: list[str]


class ClipList(BaseModel):
    clips: list[ClipOut]


class MetaOut(BaseModel):
    title: str
    description: str
    hashtags: list[str]


class WordsOut(BaseModel):
    words: list[str]


class StyleOut(BaseModel):
    style_key: str
    reason: str


class HookAIRequest(BaseModel):
    srt_text: str
    language: str = "Indonesian"
    clip_start: float | None = None
    clip_end: float | None = None


class AnalyzeReq(BaseModel):
    srt_text: str
    video_duration: float = Field(gt=0)
    language: str = "Indonesian"


class MetaReq(BaseModel):
    srt_text: str
    platform: str = "TikTok"
    language: str = "Indonesian"
    clip_start: float | None = None
    clip_end: float | None = None


class StyleReq(BaseModel):
    srt_text: str
    clip_start: float | None = None
    clip_end: float | None = None


def gemini_json(prompt: str, schema: type[BaseModel]):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or api_key == "ISI_API_KEY_GEMINI_KAMU":
        raise HTTPException(400, f"GEMINI_API_KEY belum diisi di {ROOT_DIR / 'backend' / '.env'}")

    preferred_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    # Urutan fallback model gratis (Flash & Flash-Lite series)
    default_fallbacks = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
    ]
    candidate_models = [preferred_model]
    for fb in default_fallbacks:
        if fb not in candidate_models:
            candidate_models.append(fb)

    client = genai.Client(api_key=api_key)
    last_err = None

    for model in candidate_models:
        try:
            resp = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=schema, temperature=0.7
                ),
            )
            parsed = getattr(resp, "parsed", None)
            if isinstance(parsed, schema):
                return parsed
            try:
                return schema.model_validate_json(resp.text)
            except Exception as e:
                raise HTTPException(502, f"Respons Gemini tidak sesuai format: {e}")
        except HTTPException:
            raise
        except Exception as e:
            last_err = e
            err_msg = str(e).lower()
            # Tangkap 503 (high demand/unavailable), 429 (quota/rate limit), 404 (model not found/deprecated), timeout
            retryable = any(
                k in err_msg
                for k in (
                    "503",
                    "unavailable",
                    "high demand",
                    "overloaded",
                    "429",
                    "resource_exhausted",
                    "quota",
                    "rate limit",
                    "404",
                    "not_found",
                    "not available",
                    "is no longer available",
                    "timeout",
                    "deadline",
                )
            )
            if retryable:
                print(f"[Gemini Fallback] Model '{model}' mengalami kendala ({e}). Mencoba model berikutnya...")
                continue
            raise HTTPException(502, f"Gemini error ({model}): {e}")

    raise HTTPException(502, f"Semua model Gemini sedang sibuk / gagal diakses ({candidate_models}): {last_err}")


def entries_in_range(srt_text: str, cs: float | None, ce: float | None) -> list[dict]:
    entries = parse_srt(srt_text)
    if cs is not None and ce is not None:
        entries = slice_srt(entries, cs, ce)
    if not entries:
        raise HTTPException(400, "SRT kosong atau formatnya tidak valid (atau di luar rentang klip).")
    return entries


def plain_text(entries: list[dict], limit: int = 30000) -> str:
    return " ".join(e["text"].replace("\n", " ") for e in entries)[:limit]


@app.post("/api/ai/generate-hooks")
def generate_hooks(req: HookAIRequest):
    text = plain_text(entries_in_range(req.srt_text, req.clip_start, req.clip_end))
    prompt = f"""Kamu adalah editor video pendek (TikTok/Reels/Shorts) profesional.
Baca transkrip berikut dan buat TEPAT 5 opsi kalimat HOOK yang memancing rasa penasaran di 3 detik pertama.
Aturan:
- Maksimal 8 kata per hook, punchy, relevan dengan isi transkrip, jangan clickbait yang tidak sesuai isi.
- Bahasa: {req.language}.
- recommended_seconds: berapa detik hook sebaiknya tampil (2-5).
- reason: satu kalimat singkat kenapa hook ini efektif.

Transkrip:
{text}
"""
    out = gemini_json(prompt, HookList)
    return {"hooks": [h.model_dump() for h in out.hooks[:5]]}


def validate_clips(clips: list[ClipOut], entries: list[dict], duration: float) -> list[dict]:
    MIN_LEN, MAX_LEN = 20.0, 65.0
    cands: list[dict] = []
    for c in clips:
        s, e = max(0.0, c.start), min(duration, c.end)
        if e <= s:
            continue
        s, e = snap_to_cues(entries, s, e)
        # Jika durasi melebihi MAX_LEN (65s), pangkas ke batas cue terdekat <= s + MAX_LEN
        if e - s > MAX_LEN:
            limit = s + MAX_LEN
            ends = [x["end"] for x in entries if s + MIN_LEN < x["end"] <= limit]
            e = max(ends) if ends else limit
        if e - s < MIN_LEN:
            continue
        cands.append({
            "start": round(s, 2), "end": round(e, 2), "duration": round(e - s, 2),
            "title": c.title.strip(), "virality_score": max(0, min(100, int(c.virality_score))),
            "reason": c.reason.strip(), "suggested_hooks": [h.strip() for h in c.suggested_hooks if h.strip()][:5],
        })
    cands.sort(key=lambda x: x["virality_score"], reverse=True)
    kept: list[dict] = []
    for c in cands:
        overlap_bad = False
        for k in kept:
            ov = min(c["end"], k["end"]) - max(c["start"], k["start"])
            if ov > 0.3 * min(c["duration"], k["duration"]):
                overlap_bad = True
                break
        if not overlap_bad:
            kept.append(c)
    return kept[:10]


@app.post("/api/ai/analyze-clips")
def analyze_clips(req: AnalyzeReq):
    entries = entries_in_range(req.srt_text, None, None)
    transcript = transcript_for_ai(entries)
    prompt = f"""Kamu adalah editor video pendek (TikTok/Reels/Shorts) profesional.
Berikut transkrip video berdurasi {req.video_duration:.0f} detik. Setiap baris berformat "[detik_mulai] teks".
Kamu HANYA membaca transkrip (tidak melihat video), jadi nilai potensi dari isi ucapan.

Pilih 5 sampai 10 segmen terbaik yang berpotensi viral sebagai klip mandiri.
Aturan KETAT DURASI:
- Setiap segmen WAJIB berdurasi 30 sampai 65 detik (target ideal 35-60 detik). DILARANG membuat klip di atas 65 detik atau di bawah 25 detik.
- Fokus pada SATU topik/cerita padat dengan hook pembuka yang kuat dan penutup/payoff yang jelas.
- start dan end dalam DETIK (angka), sesuai waktu pada transkrip. Mulai di awal kalimat yang utuh dan selesai di akhir kalimat.
- Segmen tidak boleh saling tumpang tindih.
- virality_score 0-100, jujur dan bervariasi (jangan semua tinggi).
- reason: satu-dua kalimat kenapa segmen ini menarik.
- suggested_hooks: 3 kalimat hook, maksimal 8 kata.
- title dan teks lain dalam bahasa: {req.language}.

Transkrip:
{transcript}
"""
    out = gemini_json(prompt, ClipList)
    clips = validate_clips(out.clips, entries, req.video_duration)
    if not clips:
        raise HTTPException(502, "AI tidak menghasilkan segmen yang valid. Coba analisis ulang.")
    return {"clips": clips}


@app.post("/api/ai/metadata")
def ai_metadata(req: MetaReq):
    text = plain_text(entries_in_range(req.srt_text, req.clip_start, req.clip_end))
    prompt = f"""Buat metadata posting {req.platform} untuk klip video pendek berikut.
- title: maksimal 80 karakter, menarik, jujur sesuai isi.
- description: 1-2 kalimat + ajakan singkat.
- hashtags: 5-8 hashtag relevan (diawali #, tanpa spasi).
Bahasa: {req.language}.

Transkrip klip:
{text}
"""
    out = gemini_json(prompt, MetaOut)
    tags = [t if t.startswith("#") else f"#{t}" for t in (h.strip().replace(" ", "") for h in out.hashtags) if t]
    return {"title": out.title.strip(), "description": out.description.strip(), "hashtags": tags[:8]}


@app.post("/api/ai/highlight-words")
def ai_highlight_words(req: StyleReq):
    text = plain_text(entries_in_range(req.srt_text, req.clip_start, req.clip_end))
    prompt = f"""Dari transkrip berikut, pilih 10-25 KATA TUNGGAL yang paling penting/emosional/bernilai
untuk disorot di subtitle (angka, kata kunci, kata kuat). Tulis persis seperti muncul di transkrip.
Hindari kata sambung umum.

Transkrip:
{text}
"""
    out = gemini_json(prompt, WordsOut)
    present = text.lower()
    words = []
    for w in out.words:
        w = w.strip()
        if w and " " not in w and w.lower() in present and w.lower() not in [x.lower() for x in words]:
            words.append(w)
    return {"words": words[:25]}


@app.post("/api/ai/suggest-style")
def ai_suggest_style(req: StyleReq):
    text = plain_text(entries_in_range(req.srt_text, req.clip_start, req.clip_end), limit=8000)
    options = "\n".join(f"- {k}: {v['name']}" for k, v in SUBTITLE_STYLES.items())
    prompt = f"""Pilih SATU gaya subtitle yang paling cocok dengan mood konten berikut.
Pilihan style_key (gunakan persis salah satu):
{options}
reason: satu kalimat.

Transkrip:
{text}
"""
    out = gemini_json(prompt, StyleOut)
    key = out.style_key.strip()
    if key not in SUBTITLE_STYLES:
        key = "hormozi_pop"
    return {"style_key": key, "reason": out.reason.strip()}


# ----------------------------------------------------- preview & render -----
@app.post("/api/preview/ass")
def preview_ass(req: PreviewAssRequest):
    """ASS identik dengan yang dibakar saat render. absolute_time=true -> timeline video penuh."""
    if not req.video_filename and req.youtube_url:
        meta = {"duration": req.clip_end or 300.0, "width": 1920, "height": 1080}
    else:
        video_path = safe_child(UPLOADS_DIR, req.video_filename, "video")
        meta = probe_cached(video_path)
    cs, ce = resolve_clip(req, meta)
    shift = cs if req.absolute_time else 0.0
    return {
        "ass_text": ass_from_params(req, meta, time_shift=shift),
        "play_res": {"w": 1080, "h": 1920},
        "clip_start": cs,
        "clip_end": ce,
        "time_shift": shift,
    }


def execute_render(p: RenderParams, progress_cb=None) -> dict:
    """Dipakai /api/render (sinkron) dan /api/render/start (thread)."""
    # Slice-on-export jika video_filename belum ada tapi youtube_url ada
    if not p.video_filename and p.youtube_url:
        clip_id = uuid.uuid4().hex[:10]
        out_clip = UPLOADS_DIR / f"yt_clip_{clip_id}.mp4"
        if progress_cb:
            progress_cb(5.0)
        cs = p.clip_start
        ce = p.clip_end if p.clip_end is not None else (cs + 60.0)
        try:
            downloaded = youtube_engine.download_youtube_clip(p.youtube_url, out_clip, cs, ce)
            if not downloaded.exists() or downloaded.stat().st_size < 50 * 1024:
                raise HTTPException(
                    status_code=502,
                    detail="Gagal mengunduh video dari YouTube. Pastikan koneksi stabil atau coba lagi.",
                )
            p.video_filename = downloaded.name
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=502,
                detail="Gagal mengunduh video dari YouTube. Pastikan koneksi stabil atau coba lagi.",
            )
        # Karena video sudah dipotong di rentang cs..ce, reset clip_start ke 0 dan clip_end ke durasi klip.
        # PENTING: SRT timestamp MUTLAK harus di-slice dan di-shift ke waktu relatif klip (mulai dari 0),
        # karena video yang diunduh sudah dimulai dari detik 0 (bukan dari cs).
        if p.srt_text and not p.srt_relative:
            entries = parse_srt(p.srt_text)
            # slice_srt sudah menggeser timestamp ke relatif [0..clip_dur] – JANGAN kurangi cs lagi
            sliced = slice_srt(entries, cs, ce)
            p.srt_text = to_srt(sliced) if sliced else p.srt_text
            p.srt_relative = True  # sudah relatif; jangan di-slice ulang di subtitle_engine
        p.clip_start = 0.0
        p.clip_end = max(0.5, ce - cs)

    video_path = safe_child(UPLOADS_DIR, p.video_filename, "video")
    if not video_path.exists() or video_path.stat().st_size < 50 * 1024:
        raise HTTPException(
            status_code=502,
            detail="Gagal mengunduh video dari YouTube. Pastikan koneksi stabil atau coba lagi."
            if p.youtube_url
            else "File video sumber tidak ditemukan atau rusak (< 50KB).",
        )
    meta = probe_cached(video_path)
    cs, ce = resolve_clip(p, meta)

    sfx_path = None
    if p.sfx_filename:
        sfx_path = safe_child(SFX_DIR, p.sfx_filename, "SFX")
        if not sfx_path.exists():
            raise HTTPException(404, f"SFX '{p.sfx_filename}' tidak ditemukan")

    out_id = uuid.uuid4().hex[:8]
    prefix = "preview" if p.preview_seconds else "supaisu"
    ass_path = EXPORTS_DIR / f"sub_{out_id}.ass"
    out_video = EXPORTS_DIR / f"{prefix}_{out_id}.mp4"
    ass_text = ass_from_params(p, meta)
    ass_path.write_text(ass_text, encoding="utf-8")

    dialog_lines = [line for line in ass_text.splitlines() if line.startswith("Dialogue:")]
    print(f"\n[SUBTITLE LOG] File .ass dibuat: {ass_path.name} ({len(dialog_lines)} dialog events)")
    for d in dialog_lines[:5]:
        print(f"  {d}")
    if not dialog_lines:
        print("  [PERINGATAN] Tidak ada baris dialog 'Dialogue:' di file .ass!")
    try:
        result = render_vertical_clip(
            video_path=video_path,
            ass_path=ass_path,
            fonts_dir=FONTS_DIR,
            output_path=out_video,
            layout_mode=p.layout_mode,
            main_x_offset=p.main_x_offset,
            main_y_offset=p.main_y_offset,
            main_zoom=p.main_zoom,
            camera_keyframes=[k.model_dump() for k in p.camera_keyframes],
            webcam_enabled=p.webcam_enabled,
            webcam_src=p.webcam_src.model_dump() if p.webcam_src else None,
            webcam_dst=p.webcam_dst.model_dump() if p.webcam_dst else None,
            webcam_style=p.webcam_style.model_dump(),
            subtitle_style=p.style_key,
            sfx_path=sfx_path,
            sfx_volume=p.sfx_volume,
            sfx_start_sec=p.sfx_start_sec,
            clip_start=cs,
            clip_end=ce,
            resolution=p.resolution,
            fps=p.fps,
            crf=p.crf,
            encoder=p.encoder,
            preview_seconds=p.preview_seconds,
            progress_cb=progress_cb,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    finally:
        ass_path.unlink(missing_ok=True)
    return {
        "export_filename": out_video.name,
        "export_url": f"/files/exports/{out_video.name}",
        "encoder": result["encoder"],
    }


@app.post("/api/render")
def render_clip(
    video_filename: str = Form(...),
    srt_text: str = Form(""),
    style_key: str = Form("hormozi_pop"),
    font_family: str = Form("Arial"),
    font_size: int = Form(64),
    primary_color: str = Form("#FFFF00"),
    subtitle_margin_v: int = Form(340),
    hook_text: str = Form(""),
    hook_duration_sec: float = Form(3.0),
    hook_y_margin: int = Form(180),
    layout_mode: str = Form("fill_crop"),
    main_x_offset: float = Form(0.5),
    webcam_enabled: bool = Form(False),
    webcam_src_json: str = Form("{}"),
    webcam_dst_json: str = Form("{}"),
    sfx_filename: str = Form(""),
    sfx_volume: float = Form(0.85),
):
    """Endpoint LAMA (sinkron, tanpa progress). Dipertahankan agar kompatibel."""
    try:
        webcam_src = json.loads(webcam_src_json) if webcam_enabled else None
        webcam_dst = json.loads(webcam_dst_json) if webcam_enabled else None
        params = RenderParams(
            video_filename=video_filename, srt_text=srt_text, style_key=style_key, font_family=font_family,
            font_size=font_size, primary_color=primary_color, subtitle_margin_v=subtitle_margin_v,
            hook_text=hook_text, hook_duration_sec=hook_duration_sec, hook_y_margin=hook_y_margin,
            layout_mode=layout_mode, main_x_offset=main_x_offset, webcam_enabled=webcam_enabled,
            webcam_src=webcam_src, webcam_dst=webcam_dst, sfx_filename=sfx_filename, sfx_volume=sfx_volume,
        )
    except (ValueError, json.JSONDecodeError) as e:
        raise HTTPException(422, f"Parameter tidak valid: {e}")
    return {"status": "success", **execute_render(params)}


RENDER_JOBS: dict[str, dict] = {}
_RENDER_SLOT = threading.Semaphore(1)  # satu render sekaligus; sisanya antre


def _render_worker(job_id: str, p: RenderParams) -> None:
    job = RENDER_JOBS[job_id]
    with _RENDER_SLOT:
        job.update(status="running", started_at=time.time())

        def on_progress(pct: float) -> None:
            job["progress"] = round(pct, 1)
            elapsed = time.time() - job["started_at"]
            job["eta_sec"] = round(elapsed / pct * (100 - pct)) if pct > 2 else None

        try:
            result = execute_render(p, on_progress)
            job.update(status="done", progress=100.0, eta_sec=0, **result)
        except HTTPException as e:
            job.update(status="error", error=str(e.detail))
        except Exception as e:  # jangan biarkan thread mati tanpa status
            job.update(status="error", error=f"{type(e).__name__}: {e}")


@app.post("/api/render/start")
def render_start(p: RenderParams):
    # validasi cepat sebelum antre supaya error muncul langsung di UI
    if p.video_filename:
        video_path = safe_child(UPLOADS_DIR, p.video_filename, "video")
        meta = probe_cached(video_path)
        resolve_clip(p, meta)
    elif p.youtube_url:
        youtube_engine.check_url(p.youtube_url)
    else:
        raise HTTPException(400, "video_filename atau youtube_url harus diisi")

    if p.sfx_filename and not safe_child(SFX_DIR, p.sfx_filename, "SFX").exists():
        raise HTTPException(404, f"SFX '{p.sfx_filename}' tidak ditemukan")
    job_id = uuid.uuid4().hex[:10]
    RENDER_JOBS[job_id] = {
        "status": "queued", "progress": 0.0, "eta_sec": None, "encoder": None,
        "export_url": None, "export_filename": None, "error": None,
    }
    threading.Thread(target=_render_worker, args=(job_id, p), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/render/status/{job_id}")
def render_status(job_id: str):
    job = RENDER_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job render tidak ditemukan")
    return {"job_id": job_id, **{k: v for k, v in job.items() if k != "started_at"}}


# ---------------------------------------------------------------- raw clip download -----
class DownloadRawPayload(BaseModel):
    video_filename: str | None = None
    youtube_url: str | None = None
    srt_text: str = ""
    clip_start: float = 0.0
    clip_end: float = 60.0
    title: str = "clip"


@app.post("/api/clips/download-raw")
async def download_raw_clip(payload: DownloadRawPayload):
    """
    Potong video mentah (tanpa subtitle burn-in/crop) + ekspor SRT yang sudah di-shift ke 00:00.
    Return: { video_url, srt_url, filename }
    """
    import asyncio

    start = max(0.0, payload.clip_start)
    end = max(start + 0.5, payload.clip_end)
    safe_title = re.sub(r"[^a-zA-Z0-9_\-]", "_", (payload.title or "clip"))[:40]
    uid = uuid.uuid4().hex[:8]
    out_name = f"raw_{safe_title}_{uid}"

    # --- SRT slice ---
    srt_url: str | None = None
    if payload.srt_text.strip():
        sliced_srt = slice_srt_to_zero(payload.srt_text, start, end)
        if sliced_srt.strip():
            srt_path = EXPORTS_DIR / f"{out_name}.srt"
            srt_path.write_text(sliced_srt, encoding="utf-8")
            srt_url = f"/files/exports/{srt_path.name}"

    # --- Video slice ---
    video_url: str | None = None
    mp4_name = f"{out_name}.mp4"
    mp4_path = EXPORTS_DIR / mp4_name

    if payload.video_filename:
        # Video lokal — FFmpeg slice
        src = safe_child(UPLOADS_DIR, payload.video_filename, "video")
        if not src.exists() or src.stat().st_size < 50 * 1024:
            raise HTTPException(404, f"Video '{payload.video_filename}' tidak ditemukan atau rusak (< 50KB)")
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{start:.3f}",
            "-to", f"{end:.3f}",
            "-i", str(src),
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac",
            str(mp4_path),
        ]
        loop = asyncio.get_event_loop()
        proc = await loop.run_in_executor(
            None,
            lambda: __import__("subprocess").run(cmd, capture_output=True),
        )
        if proc.returncode != 0 or not mp4_path.exists() or mp4_path.stat().st_size < 50 * 1024:
            stderr = proc.stderr.decode("utf-8", errors="replace")[-500:]
            raise HTTPException(500, f"FFmpeg gagal memotong video: {stderr}")
        video_url = f"/files/exports/{mp4_name}"

    elif payload.youtube_url:
        # YouTube — yt-dlp sections download
        try:
            loop = asyncio.get_event_loop()
            result_path = await loop.run_in_executor(
                None,
                lambda: youtube_engine.download_youtube_clip(
                    payload.youtube_url, mp4_path, start, end
                ),
            )
            if not result_path or not result_path.exists() or result_path.stat().st_size < 50 * 1024:
                raise HTTPException(
                    status_code=502,
                    detail="Gagal mengunduh video dari YouTube. Pastikan koneksi stabil atau coba lagi.",
                )
            video_url = f"/files/exports/{result_path.name}"
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=502,
                detail="Gagal mengunduh video dari YouTube. Pastikan koneksi stabil atau coba lagi.",
            )

    return {"video_url": video_url, "srt_url": srt_url, "filename": out_name}
