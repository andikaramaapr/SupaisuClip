from pathlib import Path
from video_engine import (
    compute_main_crop,
    compute_webcam_src,
    compute_webcam_dst,
    build_filter_graph,
    build_audio_graph,
    detect_encoders,
)


def test_compute_main_crop_landscape():
    # Video 1920x1080 (16:9), crop 9:16
    crop = compute_main_crop(1920, 1080, main_x_offset=0.5, main_y_offset=0.5, main_zoom=1.0)
    assert crop["h"] == 1080
    assert crop["w"] == 606 or crop["w"] == 608 or crop["w"] == int(1080 * 9 / 16) - (int(1080 * 9 / 16) % 2)
    assert crop["x"] > 0
    assert crop["y"] == 0


def test_compute_main_crop_zoom():
    crop1 = compute_main_crop(1920, 1080, main_zoom=1.0)
    crop2 = compute_main_crop(1920, 1080, main_zoom=2.0)
    # Zoom 2x menghasilkan crop width & height yang lebih kecil (area gambar membesar)
    assert crop2["w"] < crop1["w"]
    assert crop2["h"] < crop1["h"]


def test_compute_webcam_src():
    src_rect = {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}
    res = compute_webcam_src(1920, 1080, src_rect)
    assert res["x"] == int(1920 * 0.1)
    assert res["y"] == int(1080 * 0.2)
    assert res["w"] % 2 == 0
    assert res["h"] % 2 == 0


def test_compute_webcam_dst():
    dst_rect = {"x": 50, "y": 100, "w": 400, "h": 400}
    res = compute_webcam_dst(dst_rect)
    assert res["x"] == 50
    assert res["y"] == 100
    assert res["w"] == 400
    assert res["h"] == 400
    assert res["w"] % 2 == 0


def test_build_filter_graph_fill_crop():
    meta = {"width": 1920, "height": 1080}
    ass_path = Path("E:/test/sub.ass")
    fonts_dir = Path("E:/test/fonts")
    graph = build_filter_graph(
        meta,
        ass_path,
        fonts_dir,
        layout_mode="fill_crop",
        webcam_enabled=False,
        resolution=1080,
    )
    assert "crop=" in graph
    assert "scale=1080:1920" in graph
    assert "ass=" in graph
    assert "[vout]" in graph


def test_build_filter_graph_blur_bg():
    meta = {"width": 1920, "height": 1080}
    ass_path = Path("E:/test/sub.ass")
    fonts_dir = Path("E:/test/fonts")
    graph = build_filter_graph(
        meta,
        ass_path,
        fonts_dir,
        layout_mode="blur_bg",
        webcam_enabled=False,
        resolution=1080,
    )
    assert "boxblur=" in graph
    assert "overlay=" in graph


def test_build_filter_graph_with_webcam():
    meta = {"width": 1920, "height": 1080}
    ass_path = Path("E:/test/sub.ass")
    fonts_dir = Path("E:/test/fonts")
    webcam_src = {"x": 0.0, "y": 0.0, "w": 0.3, "h": 0.3}
    webcam_dst = {"x": 40, "y": 60, "w": 320, "h": 320}
    graph = build_filter_graph(
        meta,
        ass_path,
        fonts_dir,
        layout_mode="fill_crop",
        webcam_enabled=True,
        webcam_src=webcam_src,
        webcam_dst=webcam_dst,
        resolution=1080,
    )
    assert "cam" in graph
    assert "[with_cam]" in graph


def test_build_audio_graph():
    graph, maps = build_audio_graph(has_audio=True, sfx=False, sfx_volume=0.85, sfx_start_sec=0.0)
    assert maps == ["-map", "0:a"]

    graph_sfx, maps_sfx = build_audio_graph(has_audio=True, sfx=True, sfx_volume=1.0, sfx_start_sec=1.0)
    assert "amix=" in graph_sfx
    assert maps_sfx == ["-map", "[aout]"]


def test_detect_encoders():
    res = detect_encoders()
    assert "available" in res
    assert "recommended" in res
    assert len(res["available"]) >= 1
    assert "libx264" in res["available"]
