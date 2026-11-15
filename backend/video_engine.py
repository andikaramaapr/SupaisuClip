"""Mesin video: probe, rumus layout (dipakai juga oleh frontend computeLayout), render FFmpeg.

Prasyarat: ffmpeg + ffprobe ada di PATH (build dengan libass; build 'full' dari gyan.dev OK).
"""
import json
import os
import re
import subprocess
import threading
import time
from collections import deque
from functools import lru_cache
from pathlib import Path
from typing import Callable

CANVAS_W, CANVAS_H = 1080, 1920
RESOLUTIONS = {1080: (1080, 1920), 720: (720, 1280), 540: (540, 960)}
DEFAULT_WEBCAM_STYLE = {"border_px": 4, "border_color": "#FFFFFF", "radius_px": 0}
_HEX6 = re.compile(r"^#?([0-9a-fA-F]{6})$")


# ------------------------------------------------------------- util --------
def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _even(n: float) -> int:
    n = int(n)
    return max(2, n - (n % 2))


def _run(cmd: list[str], timeout: float | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout
        )
    except FileNotFoundError:
        raise RuntimeError(f"'{cmd[0]}' tidak ditemukan di PATH. Install FFmpeg dan buka terminal baru.")


def ff_escape_path(path: Path) -> str:
    """Escape path untuk dipakai di dalam filter FFmpeg (E:\\foo\\a.ass -> E\\:/foo/a.ass)."""
    s = str(Path(path).resolve()).replace("\\", "/")
    if "'" in s:
        raise ValueError(f"Path tidak boleh mengandung tanda petik tunggal: {s}")
    return s.replace(":", "\\:")


def _hex_to_ffmpeg(hex_color: str, fallback: str = "0xFFFFFF") -> str:
    m = _HEX6.match((hex_color or "").strip())
    return f"0x{m.group(1).upper()}" if m else fallback


def _fraction(s: str | None) -> float:
    try:
        a, b = (s or "0/1").split("/")
        return float(a) / float(b) if float(b) else 0.0
    except Exception:
        return 0.0


# ------------------------------------------------------------ probe --------
def probe_video(video_path: Path) -> dict:
    """Metadata video. Raise RuntimeError dengan pesan jelas kalau gagal (tidak ada fallback diam-diam)."""
    video_path = Path(video_path)
    p = _run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video_path)])
    if p.returncode != 0:
        raise RuntimeError(f"ffprobe gagal membaca file: {p.stderr.strip()[-300:] or 'file rusak?'}")
    data = json.loads(p.stdout or "{}")
    streams = data.get("streams", [])
    vs = next((s for s in streams if s.get("codec_type") == "video"), None)
    if vs is None:
        raise RuntimeError("File tidak berisi stream video.")
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    # Rotasi (video HP portrait sering disimpan landscape + flag rotasi)
    rotation = 0
    try:
        rotation = int(float((vs.get("tags") or {}).get("rotate", 0)))
    except Exception:
        pass
    for sd in vs.get("side_data_list") or []:
        if "rotation" in sd:
            rotation = int(float(sd["rotation"]))
    w, h = int(vs["width"]), int(vs["height"])
    if abs(rotation) % 180 == 90:
        w, h = h, w

    dur_raw = vs.get("duration")
    if dur_raw in (None, "N/A"):
        dur_raw = (data.get("format") or {}).get("duration")
    try:
        duration = float(dur_raw)
    except (TypeError, ValueError):
        raise RuntimeError("Durasi video tidak terbaca.")
    if duration <= 0:
        raise RuntimeError("Durasi video tidak valid.")

    codec = vs.get("codec_name", "")
    pix_fmt = vs.get("pix_fmt", "")
    return {
        "width": w,
        "height": h,
        "duration": duration,
        "has_audio": has_audio,
        "codec": codec,
        "pix_fmt": pix_fmt,
        "fps": round(_fraction(vs.get("avg_frame_rate")) or _fraction(vs.get("r_frame_rate")) or 30.0, 3),
        "needs_proxy": not (codec == "h264" and pix_fmt in ("yuv420p", "yuvj420p")),
    }


# ----------------------------------------------------- rumus layout ---------
def compute_main_crop(
    src_w: int, src_h: int,
    main_x_offset: float = 0.5, main_y_offset: float = 0.5, main_zoom: float = 1.0,
) -> dict:
    """Kotak crop 9:16 di video sumber (piksel). Frontend computeLayout HARUS memakai rumus ini."""
    zoom = _clamp(main_zoom, 1.0, 4.0)
    if src_w * 16 >= src_h * 9:           # sumber selebar/lebih lebar dari 9:16
        base_h, base_w = float(src_h), src_h * 9 / 16
    else:                                  # sumber lebih ramping dari 9:16
        base_w, base_h = float(src_w), src_w * 16 / 9
    cw = min(_even(base_w / zoom), _even(src_w))
    ch = min(_even(base_h / zoom), _even(src_h))
    x = int((src_w - cw) * _clamp(main_x_offset, 0.0, 1.0))
    y = int((src_h - ch) * _clamp(main_y_offset, 0.0, 1.0))
    return {"x": x, "y": y, "w": cw, "h": ch}


def compute_webcam_src(src_w: int, src_h: int, src: dict) -> dict:
    """webcam_src rasio 0-1 -> kotak piksel di video sumber (genap, di dalam frame)."""
    x = int(_clamp(src["x"], 0.0, 1.0) * src_w)
    y = int(_clamp(src["y"], 0.0, 1.0) * src_h)
    w = max(32, int(_clamp(src["w"], 0.0, 1.0) * src_w))
    h = max(32, int(_clamp(src["h"], 0.0, 1.0) * src_h))
    x = min(x, max(0, src_w - 32))
    y = min(y, max(0, src_h - 32))
    w = _even(min(w, src_w - x))
    h = _even(min(h, src_h - y))
    return {"x": x, "y": y, "w": w, "h": h}


def compute_webcam_dst(dst: dict) -> dict:
    """webcam_dst (koordinat canvas 1080x1920, kotak LUAR termasuk border) -> di-clamp ke dalam canvas."""
    w = _even(_clamp(dst["w"], 80, CANVAS_W))
    h = _even(_clamp(dst["h"], 80, CANVAS_H))
    x = int(_clamp(dst["x"], 0, CANVAS_W - w))
    y = int(_clamp(dst["y"], 0, CANVAS_H - h))
    return {"x": x, "y": y, "w": w, "h": h}


def _rounded_alpha(radius: int) -> str:
    r = radius
    expr = (
        f"if(gt(abs(W/2-X),W/2-{r})*gt(abs(H/2-Y),H/2-{r}),"
        f"if(lte(hypot(abs(W/2-X)-(W/2-{r}),abs(H/2-Y)-(H/2-{r})),{r}),255,0),255)"
    )
    return f"format=yuva420p,geq=lum='p(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='{expr}'"


@lru_cache(maxsize=1)
def _amix_has_normalize() -> bool:
    p = _run(["ffmpeg", "-hide_banner", "-h", "filter=amix"])
    return "normalize" in (p.stdout + p.stderr)


# ---------------------------------------------------- filter graph ----------
def build_filter_graph(
    meta: dict,
    ass_path: Path,
    fonts_dir: Path,
    *,
    layout_mode: str = "fill_crop",
    main_x_offset: float = 0.5,
    main_y_offset: float = 0.5,
    main_zoom: float = 1.0,
    webcam_enabled: bool = False,
    webcam_src: dict | None = None,
    webcam_dst: dict | None = None,
    webcam_style: dict | None = None,
    resolution: int = 1080,
) -> str:
    """Rangkai filter_complex video. Output berlabel [vout]. Fungsi murni (mudah dites)."""
    src_w, src_h = meta["width"], meta["height"]
    use_cam = bool(webcam_enabled and webcam_src and webcam_dst)
    blur = layout_mode == "blur_bg"

    names = ["bg", "fg"] if blur else ["main"]
    if use_cam:
        names.append("cam")
    parts: list[str] = []
    if len(names) > 1:
        parts.append(f"[0:v]split={len(names)}" + "".join(f"[{n}]" for n in names))

    def src(name: str) -> str:
        return f"[{name}]" if len(names) > 1 else "[0:v]"

    # 1. Canvas dasar 1080x1920
    if blur:
        parts.append(
            f"{src('bg')}scale={CANVAS_W}:{CANVAS_H}:force_original_aspect_ratio=increase,"
            f"crop={CANVAS_W}:{CANVAS_H},boxblur=25:5[bgb]"
        )
        parts.append(f"{src('fg')}scale={CANVAS_W}:{CANVAS_H}:force_original_aspect_ratio=decrease[fgs]")
        parts.append("[bgb][fgs]overlay=(W-w)/2:(H-h)/2[base]")
    else:
        c = compute_main_crop(src_w, src_h, main_x_offset, main_y_offset, main_zoom)
        parts.append(
            f"{src('main')}crop={c['w']}:{c['h']}:{c['x']}:{c['y']},"
            f"scale={CANVAS_W}:{CANVAS_H}:flags=lanczos,setsar=1[base]"
        )
    cur = "[base]"

    # 2. Webcam popout (crop dari video yang SAMA)
    if use_cam:
        style = {**DEFAULT_WEBCAM_STYLE, **(webcam_style or {})}
        s = compute_webcam_src(src_w, src_h, webcam_src)
        d = compute_webcam_dst(webcam_dst)
        b = int(_clamp(style["border_px"], 0, 40))
        inner_w, inner_h = _even(d["w"] - 2 * b), _even(d["h"] - 2 * b)
        chain = (
            f"{src('cam')}crop={s['w']}:{s['h']}:{s['x']}:{s['y']},"
            f"scale={inner_w}:{inner_h}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={inner_w}:{inner_h}"
        )
        if b > 0:
            chain += f",pad={d['w']}:{d['h']}:{b}:{b}:color={_hex_to_ffmpeg(style['border_color'])}"
        radius = int(_clamp(style["radius_px"], 0, min(d["w"], d["h"]) // 2))
        if radius > 0:
            chain += "," + _rounded_alpha(radius)
        parts.append(chain + "[camv]")
        parts.append(f"{cur}[camv]overlay={d['x']}:{d['y']}:format=auto[with_cam]")
        cur = "[with_cam]"

    # 3. ASS (dihitung di 1080x1920), baru kemudian di-scale kalau resolusi lebih kecil
    ass_esc, fonts_esc = ff_escape_path(ass_path), ff_escape_path(fonts_dir)
    out_w, out_h = RESOLUTIONS.get(resolution, RESOLUTIONS[1080])
    if (out_w, out_h) == (CANVAS_W, CANVAS_H):
        parts.append(f"{cur}ass='{ass_esc}':fontsdir='{fonts_esc}'[vout]")
    else:
        parts.append(f"{cur}ass='{ass_esc}':fontsdir='{fonts_esc}'[asv]")
        parts.append(f"[asv]scale={out_w}:{out_h}:flags=lanczos[vout]")
    return ";".join(parts)


def build_audio_graph(has_audio: bool, sfx: bool, sfx_volume: float, sfx_start_sec: float) -> tuple[str, list[str]]:
    """Return (potongan filter_complex audio atau '', argumen -map audio)."""
    vol = _clamp(sfx_volume, 0.0, 3.0)
    delay_ms = int(max(0.0, sfx_start_sec) * 1000)
    if sfx and has_audio:
        mix = "amix=inputs=2:duration=first:dropout_transition=0"
        mix += ":normalize=0" if _amix_has_normalize() else ",volume=2"
        return (
            f"[1:a]volume={vol},adelay={delay_ms}:all=1[sfx];[0:a][sfx]{mix}[aout]",
            ["-map", "[aout]"],
        )
    if sfx:
        return f"[1:a]volume={vol},adelay={delay_ms}:all=1,apad[aout]", ["-map", "[aout]"]
    if has_audio:
        return "", ["-map", "0:a"]
    return "", ["-an"]


# ------------------------------------------------------ encoder ------------
_HW_ENCODERS = ["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"]


@lru_cache(maxsize=1)
def detect_encoders() -> dict:
    """Cek encoder H.264 yang benar-benar bisa dipakai (tes encode 1 frame). Hasil di-cache."""
    listing = _run(["ffmpeg", "-hide_banner", "-encoders"])
    text = listing.stdout + listing.stderr
    available: list[str] = []
    for enc in _HW_ENCODERS:
        if enc in text:
            t = _run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                 "-i", "color=c=black:s=256x256:d=0.2:r=10", "-frames:v", "1",
                 "-c:v", enc, "-f", "null", "-"],
                timeout=20,
            )
            if t.returncode == 0:
                available.append(enc)
    if "libx264" in text:
        available.append("libx264")
    if not available:
        raise RuntimeError("FFmpeg tidak punya encoder H.264 (libx264).")
    return {"available": available, "recommended": available[0], "threads": os.cpu_count() or 4}


def _encoder_args(enc: str, crf: int, resolution: int, fast: bool) -> list[str]:
    if fast or enc == "libx264":
        return ["-c:v", "libx264", "-preset", "ultrafast" if fast else "fast", "-crf", str(28 if fast else crf)]
    if enc == "h264_nvenc":
        return ["-c:v", enc, "-preset", "p5", "-rc", "vbr", "-cq", str(crf), "-b:v", "0"]
    if enc == "h264_qsv":
        return ["-c:v", enc, "-global_quality", str(crf), "-preset", "medium"]
    if enc == "h264_amf":
        return ["-c:v", enc, "-quality", "quality", "-rc", "cqp",
                "-qp_i", str(crf), "-qp_p", str(crf), "-qp_b", str(crf)]
    if enc == "h264_videotoolbox":
        return ["-c:v", enc, "-b:v", "12M" if resolution >= 1080 else "7M"]
    return ["-c:v", "libx264", "-preset", "fast", "-crf", str(crf)]


# ------------------------------------------------------ render --------------
def render_vertical_clip(
    video_path: Path,
    ass_path: Path,
    fonts_dir: Path,
    output_path: Path,
    *,
    layout_mode: str = "fill_crop",
    main_x_offset: float = 0.5,
    main_y_offset: float = 0.5,
    main_zoom: float = 1.0,
    webcam_enabled: bool = False,
    webcam_src: dict | None = None,
    webcam_dst: dict | None = None,
    webcam_style: dict | None = None,
    sfx_path: Path | None = None,
    sfx_volume: float = 0.85,
    sfx_start_sec: float = 0.0,
    clip_start: float = 0.0,
    clip_end: float | None = None,
    resolution: int = 1080,
    fps: int | None = None,
    crf: int = 20,
    encoder: str = "auto",
    preview_seconds: float | None = None,
    progress_cb: Callable[[float], None] | None = None,
) -> dict:
    """Render klip vertikal 1080x1920 (atau 720p). Timestamp output mulai dari 0.
    Return {"output_path", "encoder"}. Raise RuntimeError kalau FFmpeg gagal."""
    video_path, output_path = Path(video_path), Path(output_path)
    meta = probe_video(video_path)

    cs = max(0.0, float(clip_start))
    ce = min(float(clip_end) if clip_end is not None else meta["duration"], meta["duration"])
    if cs >= meta["duration"] or ce - cs < 0.5:
        raise ValueError(
            f"Rentang klip tidak valid: {cs:.1f}s-{ce:.1f}s (durasi video {meta['duration']:.1f}s, minimal 0.5s)."
        )
    dur = ce - cs
    fast = bool(preview_seconds)
    if fast:
        dur = min(dur, float(preview_seconds))
        resolution = 540

    video_graph = build_filter_graph(
        meta, ass_path, fonts_dir,
        layout_mode=layout_mode, main_x_offset=main_x_offset, main_y_offset=main_y_offset,
        main_zoom=main_zoom, webcam_enabled=webcam_enabled, webcam_src=webcam_src,
        webcam_dst=webcam_dst, webcam_style=webcam_style, resolution=resolution,
    )
    use_sfx = bool(sfx_path and Path(sfx_path).exists())
    audio_graph, audio_map = build_audio_graph(meta["has_audio"], use_sfx, sfx_volume, sfx_start_sec)
    graph = video_graph + (";" + audio_graph if audio_graph else "")

    info = detect_encoders()
    if fast:
        candidates = ["libx264"]
    elif encoder == "auto":
        candidates = [info["recommended"]] + (["libx264"] if info["recommended"] != "libx264" else [])
    elif encoder in info["available"]:
        candidates = [encoder] + (["libx264"] if encoder != "libx264" else [])
    else:
        raise ValueError(f"Encoder '{encoder}' tidak tersedia. Pilihan: {', '.join(info['available'])}")

    last_error = ""
    for enc in candidates:
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
               "-ss", f"{cs:.3f}", "-t", f"{dur:.3f}", "-i", str(video_path)]
        if use_sfx:
            cmd += ["-i", str(sfx_path)]
        cmd += ["-filter_complex", graph, "-map", "[vout]", *audio_map]
        if fps:
            cmd += ["-r", str(int(fps))]
        cmd += [*_encoder_args(enc, int(crf), resolution, fast), "-pix_fmt", "yuv420p"]
        if audio_map != ["-an"]:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        cmd += ["-movflags", "+faststart", "-t", f"{dur:.3f}", str(output_path)]

        ok, err = _run_ffmpeg_with_progress(cmd, dur, progress_cb)
        if ok:
            if progress_cb:
                progress_cb(100.0)
            return {"output_path": output_path, "encoder": enc}
        last_error = err
    raise RuntimeError(f"FFmpeg gagal:\n{last_error}")


def _run_ffmpeg_with_progress(cmd: list[str], dur: float, cb: Callable[[float], None] | None) -> tuple[bool, str]:
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError:
        raise RuntimeError("ffmpeg tidak ditemukan di PATH.")
    tail: deque[str] = deque(maxlen=40)

    def _drain():
        for line in proc.stderr:
            tail.append(line.rstrip())

    t = threading.Thread(target=_drain, daemon=True)
    t.start()
    for line in proc.stdout:
        line = line.strip()
        if cb and (line.startswith("out_time_us=") or line.startswith("out_time_ms=")):
            try:
                micro = int(line.split("=", 1)[1])
                cb(min(99.0, max(0.0, micro / 1_000_000 / dur * 100)))
            except ValueError:
                pass
    proc.wait()
    t.join(timeout=2)
    return proc.returncode == 0, "\n".join(tail)


def ensure_preview_proxy(video_path: Path, proxy_path: Path) -> Path:
    """Proxy H.264 720p untuk diputar di browser (render tetap memakai file asli)."""
    proxy_path = Path(proxy_path)
    if proxy_path.exists() and proxy_path.stat().st_size > 0:
        return proxy_path
    tmp = proxy_path.with_suffix(".part.mp4")
    p = _run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video_path),
         "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(tmp)]
    )
    if p.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Gagal membuat proxy preview:\n{p.stderr[-400:]}")
    tmp.replace(proxy_path)
    return proxy_path


# ---------------------------------------------------------- SFX preset -------
def ensure_default_sfx(sfx_dir: Path) -> None:
    sfx_dir = Path(sfx_dir)
    sfx_dir.mkdir(parents=True, exist_ok=True)
    presets = {
        "preset_pop.wav": ["-f", "lavfi", "-i", "aevalsrc=sin(2*PI*(600-450*t)*t)*exp(-18*t):d=0.35:s=44100"],
        "preset_whoosh.wav": ["-f", "lavfi", "-i", "anoisesrc=d=0.6:c=pink:r=44100",
                              "-af", "afade=t=in:ss=0:d=0.25,afade=t=out:st=0.3:d=0.3,lowpass=f=1200"],
        "preset_bass_hit.wav": ["-f", "lavfi", "-i", "aevalsrc=sin(2*PI*(110*exp(-3*t))*t)*exp(-3.5*t):d=0.9:s=44100"],
    }
    for name, args in presets.items():
        target = sfx_dir / name
        if not target.exists():
            try:
                _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args, str(target)], timeout=30)
            except RuntimeError:
                return  # ffmpeg belum terpasang; error jelas muncul saat render
