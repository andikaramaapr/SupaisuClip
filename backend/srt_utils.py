"""Utilitas SRT: parse, bersihkan auto-caption YouTube, potong segmen, snap ke batas cue.

Semua waktu internal dalam DETIK (float). Konversi ke format SRT/ASS dilakukan di tepi.
"""
import re

_TS = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})")
_TAGS = re.compile(r"<[^>]+>|\{\\[^}]*\}")


def ts_to_sec(ts: str) -> float:
    """'00:01:23,456' atau '00:01:23.456' -> detik. Raise ValueError kalau format salah."""
    m = _TS.search(ts)
    if not m:
        raise ValueError(f"Timestamp tidak valid: {ts!r}")
    h, mi, s, frac = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(frac.ljust(3, "0")) / 1000


def sec_to_ts(sec: float) -> str:
    """Detik -> '00:01:23,456'."""
    ms_total = round(max(0.0, sec) * 1000)
    h, rest = divmod(ms_total, 3_600_000)
    m, rest = divmod(rest, 60_000)
    s, ms = divmod(rest, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_srt(text: str) -> list[dict]:
    """Parse SRT jadi [{start, end, text}] (detik). Toleran: tanpa nomor urut, titik/koma,
    CRLF, BOM, tag HTML. Blok rusak dilewati, bukan bikin crash."""
    text = (text or "").replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    entries: list[dict] = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            continue
        try:
            a, b = lines[idx].split("-->", 1)
            start, end = ts_to_sec(a), ts_to_sec(b)
        except ValueError:
            continue
        body = _TAGS.sub("", "\n".join(lines[idx + 1:])).strip()
        if body and end > start:
            entries.append({"start": start, "end": end, "text": body})
    return entries


def validate_srt(text: str) -> list[dict]:
    """Daftar masalah per blok: [{block, line, message}]. Untuk editor SRT di UI."""
    problems: list[dict] = []
    text = (text or "").replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    last_end = 0.0
    for n, block in enumerate(re.split(r"\n\s*\n", text.strip()), 1):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            problems.append({"block": n, "message": "Baris timestamp (-->) tidak ditemukan"})
            continue
        try:
            a, b = lines[idx].split("-->", 1)
            start, end = ts_to_sec(a), ts_to_sec(b)
        except ValueError:
            problems.append({"block": n, "message": "Format timestamp salah"})
            continue
        if end <= start:
            problems.append({"block": n, "message": "Waktu selesai harus lebih besar dari mulai"})
        if start < last_end - 0.001:
            problems.append({"block": n, "message": "Tumpang tindih dengan baris sebelumnya"})
        if not "\n".join(lines[idx + 1:]).strip():
            problems.append({"block": n, "message": "Teks kosong"})
        last_end = max(last_end, end)
    return problems


def to_srt(entries: list[dict]) -> str:
    return "\n".join(
        f"{i}\n{sec_to_ts(e['start'])} --> {sec_to_ts(e['end'])}\n{e['text']}\n"
        for i, e in enumerate(entries, 1)
    )


def clean_auto_srt(entries: list[dict], min_duration: float = 0.4) -> list[dict]:
    """Bersihkan auto-caption YouTube yang 'bergulir' (rolling captions).

    1. Tiap baris unik dilacak: muncul pertama kali di cue X, bertahan selama masih ada di cue berikutnya.
    2. Tiap baris ditampilkan dari kemunculan pertamanya sampai baris berikutnya muncul (tidak tumpang tindih).
    3. Baris yang jadi terlalu singkat (< min_duration, mis. cue transisi 10-50 ms) DIGABUNG ke baris
       berikutnya, bukan dibuang, sehingga tidak ada kata yang hilang.
    Heuristik: hasilnya tetap perlu dicek di editor SRT."""
    items: list[dict] = []
    prev_map: dict[str, dict] = {}
    for e in entries:
        cur_map: dict[str, dict] = {}
        for ln in (x.strip() for x in e["text"].split("\n")):
            if not ln:
                continue
            if ln in prev_map:
                it = prev_map[ln]
                it["last_end"] = max(it["last_end"], e["end"])
            else:
                it = {"text": ln, "start": e["start"], "last_end": e["end"]}
                items.append(it)
            cur_map[ln] = it
        prev_map = cur_map

    for i, it in enumerate(items):
        nxt = items[i + 1]["start"] if i + 1 < len(items) else it["last_end"]
        it["end"] = max(it["start"], min(it["last_end"], nxt))

    out: list[dict] = []
    carry: dict | None = None  # baris pendek yang menunggu digabung ke baris berikutnya
    for it in items:
        cur = {"start": it["start"], "end": it["end"], "text": it["text"]}
        if carry:
            cur = {"start": carry["start"], "end": max(cur["end"], carry["end"]),
                   "text": f"{carry['text']} {cur['text']}"}
            carry = None
        if cur["end"] - cur["start"] < min_duration:
            carry = cur
        else:
            out.append(cur)
    if carry:
        if out:
            out[-1]["text"] += " " + carry["text"]
            out[-1]["end"] = max(out[-1]["end"], carry["end"])
        elif carry["end"] - carry["start"] > 0.05:
            out.append(carry)
    return out


def slice_srt(entries: list[dict], clip_start: float, clip_end: float) -> list[dict]:
    """Ambil cue yang beririsan dengan [clip_start, clip_end], geser waktunya agar klip mulai dari 0."""
    out: list[dict] = []
    for e in entries:
        if e["end"] <= clip_start or e["start"] >= clip_end:
            continue
        s = max(e["start"], clip_start) - clip_start
        t = min(e["end"], clip_end) - clip_start
        if t - s > 0.01:
            out.append({"start": s, "end": t, "text": e["text"]})
    return out


def snap_to_cues(entries: list[dict], start: float, end: float) -> tuple[float, float]:
    """Geser start ke awal cue terdekat dan end ke akhir cue terdekat (tidak terpotong di tengah kalimat)."""
    if not entries:
        return start, end
    s = min((e["start"] for e in entries), key=lambda t: abs(t - start))
    t = min((e["end"] for e in entries), key=lambda t: abs(t - end))
    return (s, t) if t > s else (start, end)


def transcript_for_ai(entries: list[dict], max_chars: int = 400_000) -> str:
    """Format ringkas '[detik] teks' per cue untuk prompt AI (waktu dalam detik, 1 desimal)."""
    lines: list[str] = []
    total = 0
    for e in entries:
        line = f"[{e['start']:.1f}] {e['text'].replace(chr(10), ' ')}"
        total += len(line) + 1
        if total > max_chars:
            lines.append("[...transkrip dipotong karena terlalu panjang...]")
            break
        lines.append(line)
    return "\n".join(lines)
