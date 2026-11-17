"""Unduh video YouTube (utuh) + subtitle bawaan YouTube lewat yt-dlp.

- Video diunduh UTUH. Pemotongan segmen terjadi saat render, bukan di sini.
- Subtitle YouTube dipakai sebagai DEFAULT; user bisa menggantinya dengan SRT upload.
- Subtitle diunduh terpisah dari video: gagal subtitle (mis. HTTP 429) tidak menggagalkan video.
"""
import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

from srt_utils import clean_auto_srt, parse_srt, to_srt

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / ".cache" / "yt-dlp"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

YTDLP = [sys.executable, "-m", "yt_dlp"]  # pakai yt-dlp dari venv yang menjalankan backend
VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov"}
JOBS: dict[str, dict] = {}
_PROG = re.compile(r"PROG\|\s*([\d.]+)%")


def _env() -> dict:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def check_url(url: str) -> str:
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise ValueError("Link harus diawali http:// atau https://")
    return url


def _base() -> list[str]:
    args = ["--cache-dir", str(CACHE_DIR), "--no-playlist"]
    browser = os.getenv("YTDLP_COOKIES_BROWSER", "").strip()  # contoh: chrome, firefox, edge
    if browser:
        args += ["--cookies-from-browser", browser]
    return args


def _find_video(uploads_dir: Path, job_id: str) -> Path | None:
    return next(
        (f for f in sorted(uploads_dir.glob(f"{job_id}.*")) if f.suffix.lower() in VIDEO_EXTS),
        None,
    )


def pick_default_subtitle(subs: dict) -> dict | None:
    """Urutan: manual id -> manual en -> auto *-orig -> auto id -> auto en -> manual apa saja."""
    manual, auto = subs.get("manual", []), subs.get("auto", [])
    for lang in ("id", "en"):
        if lang in manual:
            return {"lang": lang, "source": "manual"}
    for lang in auto:
        if lang.endswith("-orig"):
            return {"lang": lang, "source": "auto"}
    for lang in ("id", "en"):
        if lang in auto:
            return {"lang": lang, "source": "auto"}
    if manual:
        return {"lang": manual[0], "source": "manual"}
    return None


def fetch_info(url: str) -> dict:
    """Metadata saja (tanpa download)."""
    url = check_url(url)
    p = subprocess.run(
        YTDLP + _base() + ["--skip-download", "--dump-single-json", url],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=_env(),
    )
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip()[-600:] or "Gagal mengambil info video")
    d = json.loads(p.stdout)
    manual = sorted((d.get("subtitles") or {}).keys())
    autos = list((d.get("automatic_captions") or {}).keys())
    auto = [k for k in autos if k.endswith("-orig")] or [k for k in ("id", "en") if k in autos]
    subs = {"manual": manual, "auto": auto}
    return {
        "title": d.get("title"),
        "uploader": d.get("uploader"),
        "duration": d.get("duration"),
        "width": d.get("width"),
        "height": d.get("height"),
        "thumbnail": d.get("thumbnail"),
        "subs": subs,
        "default_sub": pick_default_subtitle(subs),
    }


def fetch_subtitles(url: str, uploads_dir: Path, job_id: str, lang: str, source: str) -> str:
    """Ambil subtitle YouTube. source: 'manual' | 'auto'. Return teks SRT (auto sudah dibersihkan)."""
    url = check_url(url)
    if source not in ("manual", "auto"):
        raise ValueError("source harus 'manual' atau 'auto'")
    if not re.fullmatch(r"[A-Za-z0-9_-]{2,20}", lang or ""):
        raise ValueError("Kode bahasa tidak valid")
    for old in Path(uploads_dir).glob(f"{job_id}.sub.*"):
        old.unlink(missing_ok=True)
    flag = "--write-subs" if source == "manual" else "--write-auto-subs"
    p = subprocess.run(
        YTDLP + _base() + [
            "--skip-download", flag, "--sub-langs", re.escape(lang),
            "--sub-format", "vtt/best", "--convert-subs", "srt",
            "-o", str(Path(uploads_dir) / f"{job_id}.sub.%(ext)s"), url,
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=_env(),
    )
    files = sorted(Path(uploads_dir).glob(f"{job_id}.sub.*.srt"))
    if p.returncode != 0 or not files:
        raise RuntimeError((p.stderr or p.stdout).strip()[-500:] or "Subtitle tidak ditemukan")
    entries = parse_srt(files[0].read_text(encoding="utf-8", errors="ignore"))
    if source == "auto":
        entries = clean_auto_srt(entries)
    if not entries:
        raise RuntimeError("Subtitle kosong setelah dibersihkan")
    return to_srt(entries)


def start_download(url: str, job_id: str, uploads_dir: Path,
                   sub_lang: str = "", sub_source: str = "none") -> None:
    url = check_url(url)
    JOBS[job_id] = {
        "status": "running", "stage": "video", "progress": 0.0, "error": None,
        "video_filename": None, "srt_text": "", "srt_source": "none", "warnings": [],
    }
    threading.Thread(
        target=_download, args=(url, job_id, Path(uploads_dir), sub_lang, sub_source), daemon=True
    ).start()


def _download(url: str, job_id: str, uploads_dir: Path, sub_lang: str, sub_source: str) -> None:
    job = JOBS[job_id]
    cmd = YTDLP + _base() + [
        "-S", "res:1080,vcodec:h264,acodec:aac",  # H.264 supaya bisa diputar di browser
        "--merge-output-format", "mp4",
        "--newline",
        "--progress-template", "download:PROG|%(progress._percent_str)s",
        "-o", str(uploads_dir / f"{job_id}.%(ext)s"),
        url,
    ]
    tail: list[str] = []
    streams = 0
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", env=_env(),
        )
        for line in proc.stdout:
            if "[download] Destination:" in line:
                streams += 1  # stream pertama = video, kedua = audio
            m = _PROG.search(line)
            if m:
                pct = float(m.group(1))
                job["progress"] = round(pct * 0.9 if streams <= 1 else 90 + pct * 0.1, 1)
            else:
                tail = (tail + [line.strip()])[-15:]
        proc.wait()
        vid = _find_video(uploads_dir, job_id)
        if proc.returncode != 0 or not vid:
            raise RuntimeError("\n".join(tail) or "yt-dlp gagal tanpa pesan")
        job.update(video_filename=vid.name, progress=100.0)

        if sub_lang and sub_source in ("manual", "auto"):
            job["stage"] = "subtitles"
            try:
                job["srt_text"] = fetch_subtitles(url, uploads_dir, job_id, sub_lang, sub_source)
                job["srt_source"] = sub_source
            except Exception as e:  # gagal subtitle != gagal video
                job["warnings"].append(f"Subtitle YouTube gagal diambil: {e}")
        job["stage"] = "done"
        job["status"] = "done"
    except Exception as e:
        job.update(status="error", error=str(e))


def download_youtube_clip(url: str, output_path: Path, start_sec: float, end_sec: float) -> Path:
    """Unduh HANYA potongan video rentang start_sec - end_sec via yt-dlp --download-sections.
    Fallback: jika hasil < 50 KB atau returncode != 0, unduh full lalu potong dengan FFmpeg.
    """
    url = check_url(url)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    section_str = f"*{max(0.0, start_sec):.2f}-{max(start_sec + 0.5, end_sec):.2f}"

    # Format selector kompatibel H.264 + AAC agar tidak gagal decode
    FMT = "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"

    def _run_ytdlp(extra_args: list[str], out: Path) -> subprocess.CompletedProcess:
        cmd = YTDLP + _base() + [
            "-f", FMT,
            "--download-sections", section_str,
            "--force-keyframes-at-cuts",
            "--merge-output-format", "mp4",
            "-o", str(out),
        ] + extra_args + [url]
        return subprocess.run(
            cmd, capture_output=True, text=True,
            encoding="utf-8", errors="replace", env=_env(),
        )

    MIN_SIZE = 50 * 1024  # 50 KB

    def _result_ok(p: Path) -> bool:
        return p.exists() and p.stat().st_size >= MIN_SIZE

    # --- Percobaan 1: default ---
    p = _run_ytdlp([], output_path)
    if p.returncode == 0 and _result_ok(output_path):
        return output_path

    # Cari candidate dengan extension berbeda (yt-dlp kadang ubah ext)
    for c in sorted(output_path.parent.glob(f"{output_path.stem}.*")):
        if c.suffix.lower() in VIDEO_EXTS and _result_ok(c):
            return c

    # --- Percobaan 2: android+web player client ---
    p2_out = output_path.with_stem(output_path.stem + "_p2")
    p2 = _run_ytdlp(
        ["--extractor-args", "youtube:player_client=android,web"],
        p2_out,
    )
    result_p2: Path | None = None
    if p2.returncode == 0 and _result_ok(p2_out):
        result_p2 = p2_out
    else:
        for c in sorted(output_path.parent.glob(f"{p2_out.stem}.*")):
            if c.suffix.lower() in VIDEO_EXTS and _result_ok(c):
                result_p2 = c
                break

    if result_p2:
        # Rename ke output_path yang diinginkan
        final = output_path.with_stem(output_path.stem)
        result_p2.rename(final) if result_p2 != final else None
        return result_p2 if not final.exists() else final

    # --- Percobaan 3: Fallback — unduh video UTUH lalu potong dengan FFmpeg ---
    raw_out = output_path.with_stem(output_path.stem + "_raw")
    cmd_full = YTDLP + _base() + [
        "-f", FMT,
        "--merge-output-format", "mp4",
        "--extractor-args", "youtube:player_client=android,web",
        "-o", str(raw_out),
        url,
    ]
    pf = subprocess.run(
        cmd_full, capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=_env(),
    )
    raw_file: Path | None = None
    if pf.returncode == 0 and raw_out.exists():
        raw_file = raw_out
    else:
        for c in sorted(output_path.parent.glob(f"{raw_out.stem}.*")):
            if c.suffix.lower() in VIDEO_EXTS and c.exists():
                raw_file = c
                break

    if raw_file:
        ff_cmd = [
            "ffmpeg", "-y",
            "-ss", f"{max(0.0, start_sec):.3f}",
            "-to", f"{max(start_sec + 0.5, end_sec):.3f}",
            "-i", str(raw_file),
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-c:a", "aac",
            str(output_path),
        ]
        ff = subprocess.run(ff_cmd, capture_output=True, env=_env())
        # Hapus file raw yang besar setelah selesai
        try:
            raw_file.unlink(missing_ok=True)
        except Exception:
            pass
        if output_path.exists() and output_path.stat().st_size >= MIN_SIZE:
            return output_path

    raise RuntimeError(
        (p.stderr or p2.stderr or pf.stderr or "").strip()[-600:]
        or f"Gagal mengunduh potongan YouTube {section_str} setelah semua percobaan"
    )


def extract_youtube_frame(url: str, timestamp_sec: float, output_dir: Path) -> str:
    """Ekstrak 1 frame gambar dari stream YouTube pada timestamp_sec tertentu via ffmpeg."""
    url = check_url(url)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Ekstrak video_id untuk fallback thumbnail
    vid_match = re.search(r"(?:v=|\/)([a-zA-Z0-9_-]{11})(?:&|\/|\?|$)", url)
    video_id = vid_match.group(1) if vid_match else "default"
    fallback_url = f"https://i.ytimg.com/vi/{video_id}/2.jpg"

    try:
        # 1. Dapatkan stream URL langsung lewat yt-dlp -g
        p = subprocess.run(
            YTDLP + _base() + ["-g", "-f", "best[height<=720][ext=mp4]/best[height<=720]/best", url],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=_env(),
            timeout=15,
        )
        if p.returncode != 0 or not p.stdout.strip():
            return fallback_url
        stream_url = p.stdout.strip().split("\n")[0].strip()

        # 2. Ekstrak 1 frame menggunakan ffmpeg
        clean_ts = max(0.0, float(timestamp_sec))
        fname = f"yt_frame_{video_id}_{int(clean_ts)}.jpg"
        out_file = output_dir / fname
        if out_file.exists() and out_file.stat().st_size > 1000:
            return f"/files/uploads/{fname}"

        ff_cmd = [
            "ffmpeg",
            "-y",
            "-ss", f"{clean_ts:.2f}",
            "-i", stream_url,
            "-frames:v", "1",
            "-q:v", "2",
            str(out_file),
        ]
        ff = subprocess.run(ff_cmd, capture_output=True, timeout=15)
        if ff.returncode == 0 and out_file.exists() and out_file.stat().st_size > 0:
            return f"/files/uploads/{fname}"
        return fallback_url
    except Exception:
        return fallback_url

