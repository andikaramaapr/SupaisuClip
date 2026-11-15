from subtitle_engine import (
    SUBTITLE_STYLES,
    sanitize_font_name,
    hex_to_ass,
    seconds_to_ass,
    escape_ass_text,
    apply_highlight,
    build_ass_text,
)


def test_sanitize_font_name():
    assert sanitize_font_name("Arial, Bold") == "Arial  Bold"
    assert sanitize_font_name("") == "Arial"
    assert sanitize_font_name("Montserrat\nExtra") == "Montserrat Extra"


def test_hex_to_ass():
    # #FFFF00 -> kuning cerah (RGB FF FF 00 -> BGR 00 FF FF)
    assert hex_to_ass("#FFFF00", "&H00FFFFFF") == "&H0000FFFF"
    assert hex_to_ass("#FF0000", "&H00FFFFFF") == "&H000000FF"
    assert hex_to_ass("invalid", "&H00FFFFFF") == "&H00FFFFFF"


def test_seconds_to_ass():
    assert seconds_to_ass(0.0) == "0:00:00.00"
    assert seconds_to_ass(65.45) == "0:01:05.45"
    assert seconds_to_ass(3600.0) == "1:00:00.00"


def test_escape_ass_text():
    raw = "Ini {perintah} dan \\backslash\nbaris kedua"
    esc = escape_ass_text(raw)
    assert "{" not in esc
    assert "}" not in esc
    assert "/backslash" in esc
    assert r"\Nbaris kedua" in esc


def test_apply_highlight():
    text = "video ini sangat luar biasa dan menarik"
    hl = apply_highlight(text, ["luar biasa"], "&H000000FF", "&H00FFFFFF")
    assert r"{\c&H0000FF&}luar biasa{\c&HFFFFFF&}" in hl


def test_build_ass_text_contains_script_info_and_events():
    srt = """1
00:00:00,500 --> 00:00:02,500
Halo guys selamat datang
"""
    ass = build_ass_text(
        srt,
        style_key="hormozi_pop",
        hook_text="JANGAN SKIP!",
        hook_duration_sec=3.0,
        hook_mode="box",
        clip_duration_sec=10.0,
    )
    assert "[Script Info]" in ass
    assert "PlayResX: 1080" in ass
    assert "PlayResY: 1920" in ass
    assert "Style: MainSub" in ass
    assert "Style: HookBanner" in ass
    assert "JANGAN SKIP!" in ass
    assert "Halo guys selamat datang" in ass


def test_build_ass_text_time_shift():
    srt = """1
00:00:00,000 --> 00:00:02,000
Tes shift
"""
    ass = build_ass_text(
        srt,
        time_shift=15.0,
        srt_relative=True,
    )
    # Event harus dimulai dari detik 15: 0:00:15.00
    assert "0:00:15.00" in ass
