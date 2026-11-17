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
def generate_kinetic_cue_text(
    cue_text: str,
    cue_duration_sec: float,
    anim_type: str,
    base_color_ass: str,
    outline_color_ass: str,
    highlight_color_ass: str,
    highlight_words: list[str] | None = None,
    outline_val: int = 4,
    word_timings_cue: list[dict] | None = None,  # [{word, start_ms, end_ms}] relatif dari awal cue
) -> str:
    """
    Menghasilkan teks ASS dengan tag animasi kinetic per-kata (\\t, \\fscx, \\alpha, dll).
    Durasi kata dihitung proporsional terhadap panjang karakter dengan batas minimal 80ms.
    Jika word_timings_cue tersedia dan jumlah kata cocok, gunakan timing asli per kata.
    """
    if anim_type == "pop_in":
        anim_type = "spring_pop"
    elif anim_type == "fade_up":
        anim_type = "blur_reveal"
    elif anim_type == "zoom_soft":
        anim_type = "word_bounce"

    if anim_type == "none":
        escaped = escape_ass_text(cue_text)
        return apply_highlight(escaped, highlight_words or [], highlight_color_ass, base_color_ass)

    lines = cue_text.split("\n")
    line_words = [line.split() for line in lines]
    all_words = [w for line in line_words for w in line]
    num_words = len(all_words)
    if num_words == 0:
        return ""

    cue_dur_ms = max(200, int(cue_duration_sec * 1000))
    total_chars = sum(len(w) for w in all_words) or 1
    min_word_ms = 80

    # Gunakan word_timings_cue jika tersedia dan jumlah kata cocok (timestamp asli per kata)
    if word_timings_cue and len(word_timings_cue) == num_words:
        word_timings = [(int(wt.get("start_ms", 0)), int(wt.get("end_ms", cue_dur_ms))) for wt in word_timings_cue]
    else:
        if cue_dur_ms <= num_words * min_word_ms:
            word_durs = [cue_dur_ms / num_words] * num_words
        else:
            rem_ms = cue_dur_ms - (num_words * min_word_ms)
            word_durs = [min_word_ms + rem_ms * (len(w) / total_chars) for w in all_words]

        word_timings = []
        cur_ms = 0.0
        for i, dur in enumerate(word_durs):
            t_start = int(cur_ms)
            t_end = int(cur_ms + dur) if i < num_words - 1 else cue_dur_ms
            cur_ms += dur
            word_timings.append((t_start, t_end))

    c_base = _ass_bgr(base_color_ass)
    c_hl = _ass_bgr(highlight_color_ass)
    c_out = _ass_bgr(outline_color_ass)
    hl_clean = [hw.strip().lower() for hw in (highlight_words or []) if hw and hw.strip()]

    word_idx = 0
    rendered_lines = []

    for line in line_words:
        line_parts = []
        for w in line:
            t_s, t_e = word_timings[word_idx]
            clean_w = re.sub(r"[^\w]", "", w).lower()
            is_keyword = any(hw in clean_w for hw in hl_clean) if hl_clean else False
            c_initial = c_hl if is_keyword else c_base
            c_after = c_hl if is_keyword else c_base
            escaped_w = escape_ass_text(w)

            if anim_type == "word_bounce":
                # Semua kata terlihat. Saat diucapkan, membesar 128% -> 100% dan berubah warna ke highlight
                t_bounce = min(t_s + 60, t_e)
                t_settle = min(t_s + 140, t_e)
                tag = (
                    f"{{\\c&H{c_initial}&\\fscx100\\fscy100"
                    f"\\t({t_s},{t_bounce},\\fscx128\\fscy128\\c&H{c_hl}&)"
                    f"\\t({t_bounce},{t_settle},\\fscx100\\fscy100)"
                    f"\\t({t_e},{t_e+5},\\c&H{c_after}&)}}"
                )
            elif anim_type == "karaoke_spotlight":
                # Kata belum diucapkan transparan \\alpha&H88&, saat diucapkan menyala \\alpha&H00& + highlight
                tag = (
                    f"{{\\alpha&H88&\\c&H{c_initial}&"
                    f"\\t({t_s},{t_s+60},\\alpha&H00&\\c&H{c_hl}&)"
                    f"\\t({t_e},{t_e+5},\\c&H{c_after}&)}}"
                )
            elif anim_type == "spring_pop":
                # Kata muncul bertahap satu per satu dari skala 0% -> 115% -> 100%
                t_pop = min(t_s + 70, t_e)
                t_settle = min(t_s + 140, t_e)
                tag = (
                    f"{{\\alpha&HFF&\\fscx0\\fscy0\\c&H{c_initial}&"
                    f"\\t({t_s},{t_pop},\\alpha&H00&\\fscx115\\fscy115\\c&H{c_hl}&)"
                    f"\\t({t_pop},{t_settle},\\fscx100\\fscy100\\c&H{c_after}&)}}"
                )
            elif anim_type == "blur_reveal":
                # Kata muncul bertahap dari blur12\\alpha&HFF& menjadi blur0\\alpha&H00& dengan scale 108% -> 100%
                t_rev = min(t_s + 110, t_e)
                tag = (
                    f"{{\\alpha&HFF&\\blur12\\fscx108\\fscy108\\c&H{c_initial}&"
                    f"\\t({t_s},{t_rev},\\alpha&H00&\\blur0\\fscx100\\fscy100\\c&H{c_after}&)}}"
                )
            elif anim_type == "impact_slam":
                # Kata menghantam masuk dari skala besar 160% -> 100% dengan transisi cepat 90ms
                t_slam = min(t_s + 90, t_e)
                tag = (
                    f"{{\\alpha&HFF&\\fscx160\\fscy160\\c&H{c_initial}&"
                    f"\\t({t_s},{t_slam},\\alpha&H00&\\fscx100\\fscy100\\c&H{c_after}&)}}"
                )
            elif anim_type == "neon_glow":
                # Kata aktif memancarkan outline/glow tebal \\bord+4\\blur4\\3c{c_hl}
                glow_bord = outline_val + 4
                tag = (
                    f"{{\\c&H{c_initial}&\\3c&H{c_out}&\\bord{outline_val}\\blur0"
                    f"\\t({t_s},{t_s+60},\\c&H{c_hl}&\\3c&H{c_hl}&\\bord{glow_bord}\\blur4)"
                    f"\\t({t_e},{t_e+60},\\c&H{c_after}&\\3c&H{c_out}&\\bord{outline_val}\\blur0)}}"
                )
            else:
                tag = ""

            line_parts.append(f"{tag}{escaped_w}")
            word_idx += 1

        rendered_lines.append(" ".join(line_parts))

    return r"\N".join(rendered_lines)


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
    subtitle_animation: str = "word_bounce", # "none" | "word_bounce" | "karaoke_spotlight" | "spring_pop" | "blur_reveal" | "impact_slam" | "neon_glow"
    clip_start: float | None = None,
    clip_end: float | None = None,
    srt_relative: bool = False,           # True: srt_text sudah relatif klip (mulai dari 0)
    clip_duration_sec: float | None = None,
    time_shift: float = 0.0,              # geser semua event (mis. +clip_start untuk preview timeline penuh)
    subtitle_offset_sec: float = 0.0,     # geser subtitle relatif terhadap audio (+ = subtitle lebih lambat)
    word_timings: list[dict] | None = None,  # [{word, start, end}] dari YouTube VTT word-level timestamps
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

    # Terapkan subtitle_offset_sec: geser semua cue (clamp agar tidak negatif)
    if subtitle_offset_sec != 0.0:
        entries = [
            {**e, "start": max(0.0, e["start"] + subtitle_offset_sec), "end": max(0.1, e["end"] + subtitle_offset_sec)}
            for e in entries
        ]

    # Normalize word_timings (adjust for clip_start offset if absolute)
    _wt = word_timings or []
    _clip_base = clip_start if (clip_start is not None and not srt_relative) else 0.0

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

            cue_dur = max(0.2, e["end"] - e["start"])

            # Cari word_timings yang cocok dengan rentang waktu cue ini (sebelum offset)
            # e["start"] sudah digeser oleh subtitle_offset_sec, jadi cari di waktu asli
            cue_start_orig = e["start"] - subtitle_offset_sec
            cue_wt: list[dict] | None = None
            if _wt:
                # Filter word_timings yang masuk dalam rentang cue, ubah ke waktu relatif (ms dari awal cue)
                cue_words = [
                    {"word": wt.get("word", ""), "start_ms": int((wt["start"] - _clip_base - cue_start_orig) * 1000),
                     "end_ms": int((wt["end"] - _clip_base - cue_start_orig) * 1000)}
                    for wt in _wt
                    if wt.get("start", -1) - _clip_base >= cue_start_orig - 0.05
                    and wt.get("end", -1) - _clip_base <= cue_start_orig + cue_dur + 0.05
                ]
                if cue_words:
                    cue_wt = cue_words

            kinetic_text = generate_kinetic_cue_text(
                text,
                cue_duration_sec=cue_dur,
                anim_type=subtitle_animation,
                base_color_ass=st["primary"],
                outline_color_ass=st["outline"],
                highlight_color_ass=hex_to_ass(highlight_color, "&H003B3BFF"),
                highlight_words=words,
                outline_val=outline_val,
                word_timings_cue=cue_wt,
            )
            events.append(
                f"Dialogue: 1,{seconds_to_ass(time_shift + e['start'])},{seconds_to_ass(time_shift + e['end'])},"
                f"MainSub,,0,0,0,,{kinetic_text}"
            )

    return header + "\n".join(events) + "\n"


def build_ass_file(output_ass_path: Path, srt_text: str, **kwargs) -> Path:
    """Tulis hasil build_ass_text ke file. Semua keyword sama dengan build_ass_text."""
    output_ass_path = Path(output_ass_path)
    output_ass_path.write_text(build_ass_text(srt_text, **kwargs), encoding="utf-8")
    return output_ass_path


# ---------------------------------------------------------------- srt utils -----
def slice_srt_to_zero(srt_text: str, start_sec: float, end_sec: float) -> str:
    """
    Ambil cue SRT yang beririsan dengan [start_sec, end_sec], clamp, geser ke 00:00:00,000, renumber.
    """
    from srt_utils import parse_srt

    def _srt_ts(sec: float) -> str:
        sec = max(0.0, sec)
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        ms = int(round((sec % 1) * 1000))
        if ms >= 1000:
            ms = 999
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    entries = parse_srt(srt_text)
    result: list[str] = []
    idx = 1
    for e in entries:
        # beririsan jika cue mulai sebelum end_sec dan cue selesai sesudah start_sec
        if e["end"] <= start_sec or e["start"] >= end_sec:
            continue
        clamped_start = max(e["start"], start_sec) - start_sec
        clamped_end = min(e["end"], end_sec) - start_sec
        result.append(
            f"{idx}\n{_srt_ts(clamped_start)} --> {_srt_ts(clamped_end)}\n{e['text'].strip()}\n"
        )
        idx += 1
    return "\n".join(result)
