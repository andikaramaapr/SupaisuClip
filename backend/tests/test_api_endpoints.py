from fastapi.testclient import TestClient
from main import app, RenderParams, Rect, WebcamStyle

client = TestClient(app)


def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "ffmpeg" in data
    assert "ffprobe" in data


def test_assets():
    res = client.get("/api/assets")
    assert res.status_code == 200
    data = res.json()
    assert "styles" in data
    assert "fonts" in data
    assert "sfx" in data
    assert "hormozi_pop" in data["styles"]


def test_system_encoders():
    res = client.get("/api/system/encoders")
    assert res.status_code == 200
    data = res.json()
    assert "available" in data
    assert "recommended" in data


def test_srt_validate():
    srt = "1\n00:00:01,000 --> 00:00:03,000\nHello"
    res = client.post("/api/srt/validate", json={"srt_text": srt})
    assert res.status_code == 200
    data = res.json()
    assert data["cue_count"] == 1
    assert len(data["problems"]) == 0


def test_srt_parse():
    srt = "1\n00:00:01,000 --> 00:00:03,000\nHello world"
    res = client.post("/api/srt/parse", json={"srt_text": srt})
    assert res.status_code == 200
    data = res.json()
    assert len(data["entries"]) == 1
    assert data["entries"][0]["text"] == "Hello world"


def test_render_params_validation_success():
    params = RenderParams(
        video_filename="test.mp4",
        srt_text="1\n00:00:01,000 --> 00:00:02,000\nTest",
        clip_start=1.0,
        clip_end=5.0,
        webcam_enabled=False,
    )
    assert params.clip_start == 1.0
    assert params.clip_end == 5.0


def test_render_params_validation_failure_clip_end():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RenderParams(
            video_filename="test.mp4",
            clip_start=10.0,
            clip_end=5.0,  # Invalid: clip_end <= clip_start
        )


def test_render_params_validation_failure_webcam_without_rects():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RenderParams(
            video_filename="test.mp4",
            webcam_enabled=True,
            webcam_src=None,
            webcam_dst=None,
        )


def test_render_params_validation_success_with_webcam():
    params = RenderParams(
        video_filename="test.mp4",
        webcam_enabled=True,
        webcam_src=Rect(x=0.0, y=0.0, w=0.3, h=0.3),
        webcam_dst=Rect(x=50.0, y=50.0, w=300.0, h=300.0),
        webcam_style=WebcamStyle(border_px=5, border_color="#FF0000", radius_px=10),
    )
    assert params.webcam_enabled is True
    assert params.webcam_src.w == 0.3
    assert params.webcam_dst.w == 300.0


def test_preview_ass_nonexistent_video():
    payload = {
        "video_filename": "nonexistent_12345.mp4",
        "srt_text": "1\n00:00:01,000 --> 00:00:03,000\nTes",
        "clip_start": 0.0,
        "clip_end": 5.0,
    }
    res = client.post("/api/preview/ass", json=payload)
    # File not found
    assert res.status_code == 404
