"""Pembangun file ASS. SATU fungsi (build_ass_text) dipakai oleh render FFmpeg dan oleh
endpoint /api/preview/ass, sehingga preview di browser memakai teks ASS yang sama persis."""
import re
from pathlib import Path

from srt_utils import parse_srt, slice_srt

try:  # fontTools lebih akurat untuk nama family yang dipakai libass
    from fontTools.ttLib import TTFont
except Exception:  # pragma: no cover
    TTFont = None

try:
    from PIL import ImageFont
except Exception:  # pragma: no cover
    ImageFont = None

SUBTITLE_STYLES = {
    # --- 8 New Presets ---
    "viral_pop": {
        "name": "VIRAL POP",
        "sub": "Hormozi Yellow Glow",
        "fontsize": 72,
        "primary": "&H0000FFFF",   # Kuning terang
        "outline": "&H00000000",   # Hitam
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 6,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 340,
    },
    "beast_punch": {
        "name": "BEAST PUNCH",
        "sub": "High Impact Green",
        "fontsize": 75,
        "primary": "&H0000FF00",   # Hijau neon
        "outline": "&H00000000",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 6,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 340,
    },
    "cyber_violet": {
        "name": "CYBER VIOLET",
        "sub": "Neon Purple Glow",
        "fontsize": 70,
        "primary": "&H00FF00CC",   # Ungu neon
        "outline": "&H00330033",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 5,
        "shadow": 4,
        "alignment": 2,
        "margin_v": 340,
    },
    "fire_crimson": {
        "name": "FIRE CRIMSON",
        "sub": "High Energy Red",
        "fontsize": 72,
        "primary": "&H002233FF",   # Merah terang
        "outline": "&H00000000",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 6,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 340,
    },
    "electric_cyan": {
        "name": "ELECTRIC CYAN",
        "sub": "Ice Blue Glow",
        "fontsize": 70,
        "primary": "&H00FFFF00",   # Cyan / Ice blue
        "outline": "&H00880000",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 5,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 340,
    },
    "golden_aura": {
        "name": "GOLDEN AURA",
        "sub": "Luxury Warm Gold",
        "fontsize": 68,
        "primary": "&H0022D4FF",   # Emas hangat
        "outline": "&H00001122",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 6,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 340,
    },
    "clean_minimal": {
        "name": "Clean Minimal",
        "sub": "Soft Dark Box",
        "fontsize": 58,
        "primary": "&H00FFFFFF",
        "outline": "&H00181818",   # Box warna gelap
        "back": "&HB0000000",
        "bold": -1,
        "border_style": 3,
        "outline_w": 12,
        "shadow": 0,
        "alignment": 2,
        "margin_v": 330,
    },
    "none": {
        "name": "✕ NONE",
        "sub": "Burn No Captions",
        "fontsize": 0,
        "primary": "&H00000000",
        "outline": "&H00000000",
        "back": "&H00000000",
        "bold": 0,
        "border_style": 1,
        "outline_w": 0,
        "shadow": 0,
        "alignment": 2,
        "margin_v": 0,
    },

    # --- Backward compatibility aliases ---
    "hormozi_pop": {
        "name": "Hormozi Bold Pop",
        "fontsize": 68,
        "primary": "&H0000FFFF",
        "outline": "&H00000000",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 6,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 340,
    },
    "clean_white": {
        "name": "Clean Creator White",
        "fontsize": 62,
        "primary": "&H00FFFFFF",
        "outline": "&H00000000",
        "back": "&H60000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 5,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 340,
    },
    "neon_cyber": {
        "name": "Neon Cyan Glow",
        "fontsize": 64,
        "primary": "&H00FFFF00",
        "outline": "&H00FF0088",
        "back": "&H00000000",
        "bold": -1,
        "border_style": 1,
        "outline_w": 5,
        "shadow": 4,
        "alignment": 2,
        "margin_v": 340,
    },
    "boxed_caption": {
        "name": "High-Contrast Box",
        "fontsize": 56,
        "primary": "&H00FFFFFF",
        "outline": "&H00111111",
        "back": "&HD0000000",
        "bold": -1,
        "border_style": 3,
        "outline_w": 14,
        "shadow": 0,
        "alignment": 2,
        "margin_v": 340,
    },
    "cinematic_minimal": {
        "name": "Cinematic Minimal",
        "fontsize": 52,
        "primary": "&H00F2F2F2",
        "outline": "&H00181818",
        "back": "&H40000000",
        "bold": 0,
        "border_style": 1,
        "outline_w": 3,
        "shadow": 1,
        "alignment": 2,
        "margin_v": 320,
    },
}

_HEX6 = re.compile(r"^#?([0-9a-fA-F]{6})$")


# ---------------------------------------------------------------- font -----
def get_font_family_name(font_path: Path) -> str:
    """Nama family (nameID 1) yang dipakai libass untuk mencocokkan font. Fallback: PIL, lalu nama file."""
    font_path = Path(font_path)
    if TTFont is not None:
        try:
            font = TTFont(str(font_path), lazy=True, fontNumber=0)
            name = font["name"].getDebugName(1)
            font.close()
            if name:
                return sanitize_font_name(name)
        except Exception:
            pass
    if ImageFont is not None:
        try:
            family, _ = ImageFont.truetype(str(font_path), size=40).getname()
            if family:
                return sanitize_font_name(family)
        except Exception:
            pass
    return sanitize_font_name(font_path.stem)


def sanitize_font_name(name: str) -> str:
    """Koma/newline merusak baris Style di ASS."""
    cleaned = re.sub(r"[,\r\n]+", " ", name or "").strip()
    return cleaned or "Arial"


# --------------------------------------------------------------- warna -----
def hex_to_ass(hex_color: str | None, fallback: str, alpha: int = 0) -> str:
    """'#RRGGBB' -> '&HAABBGGRR' (alpha 0 = opaque). Input salah -> fallback (sudah format ASS)."""
    m = _HEX6.match((hex_color or "").strip())
    if not m:
        return fallback
    hx = m.group(1)
    r, g, b = hx[0:2], hx[2:4], hx[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ass_bgr(ass_color: str) -> str:
    """'&H00BBGGRR' -> 'BBGGRR' untuk tag override \\c&HBBGGRR&."""
    return ass_color[-6:]


# ---------------------------------------------------------------- waktu ----
def seconds_to_ass(sec: float) -> str:
    """Detik -> 'H:MM:SS.cc' (tanpa bug cs==100)."""
    total_cs = max(0, round(sec * 100))
    h, rest = divmod(total_cs, 360_000)
    m, rest = divmod(rest, 6_000)
    s, cs = divmod(rest, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


# ---------------------------------------------------------------- teks -----
def escape_ass_text(text: str) -> str:
    """Hilangkan karakter yang dibaca libass sebagai perintah. Newline -> \\N."""
    text = text.replace("\\", "/").replace("{", "(").replace("}", ")")
    return text.replace("\r", "").replace("\n", r"\N")


def wrap_cue_text(text: str, max_lines: int = 2, max_chars_per_line: int = 26) -> str:
    """Bungkus teks agar tidak melebihi max_chars_per_line dan maksimal max_lines baris."""
    clean = text.replace("\r", " ").replace("\n", " ").strip()
    words = clean.split()
    if not words:
        return ""
    lines = []
    cur_line: list[str] = []
    cur_len = 0
    for w in words:
        w_len = len(w)
        if not cur_line:
            cur_line.append(w)
            cur_len = w_len
        elif cur_len + 1 + w_len <= max_chars_per_line:
            cur_line.append(w)
            cur_len += 1 + w_len
        else:
            lines.append(" ".join(cur_line))
            cur_line = [w]
            cur_len = w_len
    if cur_line:
        lines.append(" ".join(cur_line))

    if len(lines) > max_lines:
        keep = lines[:max_lines - 1]
        last = " ".join(lines[max_lines - 1:])
        lines = keep + [last]
    return "\n".join(lines)


def apply_highlight(text: str, words: list[str], hl_ass: str, base_ass: str) -> str:
    """Bungkus kata kunci dengan tag warna. Dikerjakan per baris agar tidak menyentuh '\\N'."""
    clean = [w.strip() for w in words if w and w.strip()]
    if not clean:
        return text
    clean.sort(key=len, reverse=True)
    pattern = re.compile(
        r"(?<!\w)(" + "|".join(re.escape(w) for w in clean) + r")(?!\w)",
        re.IGNORECASE | re.UNICODE,
    )
    repl = r"{\\c&H" + _ass_bgr(hl_ass) + r"&}\1{\\c&H" + _ass_bgr(base_ass) + r"&}"
    return r"\N".join(pattern.sub(repl, line) for line in text.split(r"\N"))


# ----------------------------------------------------------- pembangun -----
def build_ass_text(
    srt_text: str,
    *,
    style_key: str = "viral_pop",
    font_family: str = "Arial",
    font_size: int | None = None,
    primary_color: str | None = None,
    outline_color: str | None = None,
    margin_v: int | None = None,
    hook_text: str = "",
    hook_duration_sec: float = 3.0,       # 0 = seluruh klip
    hook_y_margin: int = 180,
    hook_font_size: int = 74,
    hook_font_family: str = "",
    hook_color: str = "#FFFFFF",
    hook_box_color: str = "#121212",
    hook_mode: str = "box",               # "box" | "text" | "clean"
    hook_animation: str = "pop_bounce",   # "pop_bounce" | "zoom_slam" | "fade_slide_up" | "typewriter_fade" | "none"
    hook_letter_style: str = "uppercase", # "uppercase" | "title" | "lowercase"
    highlight_words: list[str] | None = None,
    highlight_color: str = "#FF3B3B",
    letter_style: str = "uppercase",      # "uppercase" | "title" | "lowercase"
    subtitle_animation: str = "pop_in",   # "none" | "pop_in" | "fade_up" | "zoom_soft"
    clip_start: float | None = None,
    clip_end: float | None = None,
    srt_relative: bool = False,           # True: srt_text sudah relatif klip (mulai dari 0)
    clip_duration_sec: float | None = None,
    time_shift: float = 0.0,              # geser semua event (mis. +clip_start untuk preview timeline penuh)
) -> str:
    """Return isi file ASS (string). PlayRes selalu 1080x1920."""
    st = SUBTITLE_STYLES.get(style_key, SUBTITLE_STYLES["viral_pop"]).copy()
    if font_size:
        st["fontsize"] = int(font_size)
    if margin_v is not None:
        st["margin_v"] = int(margin_v)
    st["primary"] = hex_to_ass(primary_color, st["primary"])
    if outline_color:
        st["outline"] = hex_to_ass(outline_color, st["outline"])

    font = sanitize_font_name(font_family)
    hook_font = sanitize_font_name(hook_font_family) if (hook_font_family and hook_font_family.strip()) else font

    # Proporsi outline & shadow agar tidak memakan bagian dalam huruf
    outline_val = max(2, round(st["fontsize"] * 0.05)) if st["border_style"] == 1 else st.get("outline_w", 12)
    shadow_val = 2 if st["border_style"] == 1 else 0
    spacing_val = 1

    # --- cue: mutlak -> potong & geser ke 0; atau sudah relatif ---
    entries = parse_srt(srt_text)
    if not srt_relative and clip_start is not None and clip_end is not None:
        entries = slice_srt(entries, clip_start, clip_end)
        if clip_duration_sec is None:
            clip_duration_sec = max(0.0, clip_end - clip_start)
    if clip_duration_sec is None:
        clip_duration_sec = max((e["end"] for e in entries), default=30.0)

    # --- gaya hook ---
    if hook_mode == "text":
        hook_bs, hook_outline, hook_shadow = 1, 5, 2
        hook_outline_c, hook_back_c = "&H00000000", "&H80000000"
    elif hook_mode == "clean":
        hook_bs, hook_outline, hook_shadow = 1, 2, 0
        hook_outline_c, hook_back_c = "&H00000000", "&H00000000"
    else:  # "box" (Box Pill)
        hook_bs, hook_outline, hook_shadow = 3, 16, 0
        box = hex_to_ass(hook_box_color, "&H00121212", alpha=0x1A)
        hook_outline_c, hook_back_c = box, box
    hook_primary = hex_to_ass(hook_color, "&H00FFFFFF")

    # Animasi masuk Hook via tag transformasi ASS native
    if hook_animation == "pop_bounce":
        anim_tag = r"{\fad(80,180)\fscx0\fscy0\t(0,180,\fscx115\fscy115)\t(180,300,\fscx100\fscy100)}"
    elif hook_animation == "zoom_slam":
        anim_tag = r"{\fad(40,180)\fscx165\fscy165\t(0,160,\fscx100\fscy100)}"
    elif hook_animation == "fade_slide_up":
        y_s = int(hook_y_margin) + 50
        y_e = int(hook_y_margin)
        anim_tag = f"{{\\fad(150,180)\\move(540,{y_s},540,{y_e},0,200)}}"
    elif hook_animation == "typewriter_fade":
        anim_tag = r"{\fad(220,180)}"
    else:  # "none"
        anim_tag = r"{\fad(0,0)}"

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: MainSub,{font},{st['fontsize']},{st['primary']},&H000000FF,{st['outline']},{st['back']},"
        f"{st['bold']},0,0,0,100,100,{spacing_val},0,{st['border_style']},{outline_val},{shadow_val},"
        f"{st['alignment']},60,60,{st['margin_v']},1\n"
        f"Style: HookBanner,{hook_font},{int(hook_font_size)},{hook_primary},&H000000FF,{hook_outline_c},{hook_back_c},"
        f"-1,0,0,0,100,100,0,0,{hook_bs},{hook_outline},{hook_shadow},8,70,70,{int(hook_y_margin)},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    events: list[str] = []

    if hook_text.strip():
        htext = hook_text.strip()
        if hook_letter_style == "uppercase":
            htext = htext.upper()
        elif hook_letter_style == "lowercase":
            htext = htext.lower()
        elif hook_letter_style == "title":
            htext = htext.title()

        dur = clip_duration_sec if hook_duration_sec <= 0 else min(hook_duration_sec, clip_duration_sec)
        if dur > 0:
            events.append(
                f"Dialogue: 2,{seconds_to_ass(time_shift)},{seconds_to_ass(time_shift + dur)},HookBanner,,0,0,0,,"
                f"{anim_tag}{escape_ass_text(htext)}"
            )

    # Animasi Subtitle
    if subtitle_animation == "pop_in":
        sub_anim_tag = r"{\fscx85\fscy85\t(0,70,\fscx100\fscy100)}"
    elif subtitle_animation == "fade_up":
        sub_anim_tag = r"{\fad(90,0)}"
    elif subtitle_animation == "zoom_soft":
        sub_anim_tag = r"{\fscx108\fscy108\t(0,80,\fscx100\fscy100)}"
    else:  # "none"
        sub_anim_tag = ""

    words = highlight_words or []
    # Jika style_key == "none", lewati penambahan MainSub
    if style_key != "none":
        for e in entries:
            # Batasi teks maksimal 2 baris & 26 karakter per baris
            text = wrap_cue_text(e["text"], max_lines=2, max_chars_per_line=26)
            if letter_style == "uppercase":
                text = text.upper()
            elif letter_style == "lowercase":
                text = text.lower()
            elif letter_style == "title":
                text = text.title()

            text = escape_ass_text(text)
            text = apply_highlight(text, words, hex_to_ass(highlight_color, "&H003B3BFF"), st["primary"])
            events.append(
                f"Dialogue: 1,{seconds_to_ass(time_shift + e['start'])},{seconds_to_ass(time_shift + e['end'])},"
                f"MainSub,,0,0,0,,{sub_anim_tag}{text}"
            )

    return header + "\n".join(events) + "\n"


def build_ass_file(output_ass_path: Path, srt_text: str, **kwargs) -> Path:
    """Tulis hasil build_ass_text ke file. Semua keyword sama dengan build_ass_text."""
    output_ass_path = Path(output_ass_path)
    output_ass_path.write_text(build_ass_text(srt_text, **kwargs), encoding="utf-8")
    return output_ass_path
