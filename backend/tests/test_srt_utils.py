import pytest
from srt_utils import (
    ts_to_sec,
    sec_to_ts,
    parse_srt,
    validate_srt,
    to_srt,
    clean_auto_srt,
    slice_srt,
    snap_to_cues,
    transcript_for_ai,
)


def test_ts_to_sec_valid():
    assert ts_to_sec("00:00:00,000") == 0.0
    assert ts_to_sec("00:01:23,456") == 83.456
    assert ts_to_sec("01:00:00.500") == 3600.5


def test_ts_to_sec_invalid():
    with pytest.raises(ValueError):
        ts_to_sec("invalid_time")


def test_sec_to_ts():
    assert sec_to_ts(0.0) == "00:00:00,000"
    assert sec_to_ts(83.456) == "00:01:23,456"
    assert sec_to_ts(3661.123) == "01:01:01,123"


def test_parse_srt_simple():
    srt = """1
00:00:01,000 --> 00:00:03,000
Halo dunia

2
00:00:03,500 --> 00:00:05,000
Ini tes subtitle
"""
    entries = parse_srt(srt)
    assert len(entries) == 2
    assert entries[0]["start"] == 1.0
    assert entries[0]["end"] == 3.0
    assert entries[0]["text"] == "Halo dunia"
    assert entries[1]["start"] == 3.5
    assert entries[1]["text"] == "Ini tes subtitle"


def test_parse_srt_handles_html_and_ass_tags():
    srt = """1
00:00:00,500 --> 00:00:02,000
<font color="#ffff00">Teks <b>tebal</b></font> {\\pos(10,20)}
"""
    entries = parse_srt(srt)
    assert len(entries) == 1
    assert entries[0]["text"] == "Teks tebal"


def test_validate_srt_clean():
    srt = """1
00:00:01,000 --> 00:00:03,000
Normal cue
"""
    problems = validate_srt(srt)
    assert len(problems) == 0


def test_validate_srt_with_problems():
    srt = """1
00:00:05,000 --> 00:00:02,000
Waktu terbalik

2
00:00:01,000 --> 00:00:03,000
Tumpang tindih
"""
    problems = validate_srt(srt)
    assert len(problems) >= 2


def test_clean_auto_srt_rolling():
    # Simulasi rolling caption YouTube
    raw_entries = [
        {"start": 1.0, "end": 2.0, "text": "Halo teman"},
        {"start": 1.5, "end": 3.0, "text": "Halo teman\nselamat datang"},
        {"start": 2.5, "end": 4.0, "text": "selamat datang\ndi channel ini"},
    ]
    cleaned = clean_auto_srt(raw_entries, min_duration=0.3)
    assert len(cleaned) >= 1
    # Memastikan tidak ada duplikasi teks yang menumpuk
    texts = [c["text"] for c in cleaned]
    assert any("Halo teman" in t for t in texts)
    assert any("selamat datang" in t for t in texts)


def test_slice_srt():
    entries = [
        {"start": 5.0, "end": 10.0, "text": "Cue 1"},
        {"start": 12.0, "end": 18.0, "text": "Cue 2"},
        {"start": 25.0, "end": 30.0, "text": "Cue 3"},
    ]
    # Potong klip dari detik 10 sampai detik 20
    sliced = slice_srt(entries, 10.0, 20.0)
    assert len(sliced) == 1
    assert sliced[0]["text"] == "Cue 2"
    assert sliced[0]["start"] == 2.0  # 12 - 10
    assert sliced[0]["end"] == 8.0    # 18 - 10


def test_snap_to_cues():
    entries = [
        {"start": 2.1, "end": 5.8, "text": "Satu"},
        {"start": 6.2, "end": 11.9, "text": "Dua"},
    ]
    s, e = snap_to_cues(entries, 2.0, 12.0)
    assert s == 2.1
    assert e == 11.9


def test_snap_to_cues_empty():
    s, e = snap_to_cues([], 5.0, 15.0)
    assert s == 5.0
    assert e == 15.0


def test_to_srt_roundtrip():
    entries = [{"start": 1.0, "end": 3.0, "text": "Baris satu"}]
    res = to_srt(entries)
    assert "00:00:01,000 --> 00:00:03,000" in res
    assert "Baris satu" in res


def test_transcript_for_ai():
    entries = [
        {"start": 1.23, "end": 4.5, "text": "Kalimat pertama"},
        {"start": 5.0, "end": 8.0, "text": "Kalimat kedua"},
    ]
    out = transcript_for_ai(entries)
    assert "[1.2] Kalimat pertama" in out
    assert "[5.0] Kalimat kedua" in out
