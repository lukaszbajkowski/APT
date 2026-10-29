"""Automatyczna poprawa zdjęcia: kadr, uwagi, odrzucanie, dostęp przez konto, kadry i link."""

import io

import numpy as np
import pytest
from PIL import Image

from app import photo_fix
from tests.test_accounts import emp, hr  # noqa: F401, F811
from tests.test_data_link import _token, _verify
from tests.test_me import me  # noqa: F401, F811


def _jpeg(w=800, h=1000, color=(200, 200, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


def _fake_face(monkeypatch, faces, eyes):
    monkeypatch.setattr(photo_fix, "_faces", lambda gray: faces)
    monkeypatch.setattr(photo_fix, "_eyes", lambda gray, face: eyes)


def test_output_is_3x4_with_head_at_75_percent(monkeypatch):
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 420), (470, 420)])
    res = photo_fix.enhance(_jpeg())
    im = Image.open(io.BytesIO(res.jpeg))
    assert im.size == (600, 800)
    assert any("kadr" in c for c in res.changed)
    assert any("Wykryto jedną twarz" in n.text for n in res.notes)


def test_tilted_head_is_straightened(monkeypatch):
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 400), (470, 440)])
    assert "wyprostowano głowę" in photo_fix.enhance(_jpeg()).changed


def test_missing_eyes_gives_warning(monkeypatch):
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [])
    assert any("oczu" in n.text for n in photo_fix.enhance(_jpeg()).notes)


def test_dark_face_is_brightened_and_flat_bg_kept(monkeypatch):
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 420), (470, 420)])
    res = photo_fix.enhance(_jpeg(color=(60, 60, 60)))
    assert "wyrównano jasność" in res.changed


def test_no_face_and_many_faces_rejected(monkeypatch):
    _fake_face(monkeypatch, [], [])
    with pytest.raises(photo_fix.FixError, match="Nie wykryto twarzy"):
        photo_fix.enhance(_jpeg())
    _fake_face(monkeypatch, [(100, 200, 200, 240), (500, 200, 190, 230)], [])
    with pytest.raises(photo_fix.FixError, match="więcej niż jedna"):
        photo_fix.enhance(_jpeg())
    with pytest.raises(photo_fix.FixError):
        photo_fix.enhance(b"to nie jest obraz")
    with pytest.raises(photo_fix.FixError, match="za małe"):
        photo_fix.enhance(_jpeg(100, 120))


def test_real_detector_finds_nothing_on_flat_image():
    arr = np.full((600, 480, 3), 190, np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "JPEG")
    with pytest.raises(photo_fix.FixError):
        photo_fix.enhance(buf.getvalue())


def test_endpoints_preview_only(monkeypatch, me, hr, emp):  # noqa: F811
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 420), (470, 420)])
    files = {"file": ("a.jpg", _jpeg(), "image/jpeg")}
    r = me.post("/api/me/photo/enhance", files=files)
    assert r.status_code == 200, r.text
    assert r.json()["image"].startswith("data:image/jpeg;base64,") and r.json()["notes"]
    assert me.get("/api/me/photo").status_code == 404  # podgląd niczego nie zapisuje
    r = hr.post(f"/api/employees/{emp}/photo/enhance", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200
    _fake_face(monkeypatch, [], [])
    bad = me.post("/api/me/photo/enhance", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    assert bad.status_code in (400, 422) and "twarzy" in bad.json()["detail"]


def test_data_link_enhance_needs_access(monkeypatch, hr, emp):  # noqa: F811
    from fastapi.testclient import TestClient

    from app.main import app

    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 420), (470, 420)])
    token = _token(hr, emp, email="anna@example.com")
    pub = TestClient(app)
    url = f"/api/data-link/{token}/photo/enhance"
    assert pub.post(url, files={"file": ("a.jpg", _jpeg(), "image/jpeg")}).status_code == 403
    h = _verify(pub, token)
    assert pub.post(url, files={"file": ("a.jpg", _jpeg(), "image/jpeg")}, headers=h).status_code == 200


def test_background_replaced_using_mask_and_crown(monkeypatch):
    """Kolorowe tło + maska osoby: tło jest zastępowane, a czubek głowy bierze się z maski."""
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 420), (470, 420)])
    h, w = 1000, 800
    alpha = np.zeros((h, w), np.float32)
    alpha[180:, 200:600] = 1.0  # „postać”: czubek głowy na wysokości 180
    monkeypatch.setattr(photo_fix, "_segment", lambda img: alpha)
    seen = {}
    real = photo_fix._transform

    def spy(cx, mid, head_h, angle, ratio):
        seen["head_h"] = head_h
        return real(cx, mid, head_h, angle, ratio)

    monkeypatch.setattr(photo_fix, "_transform", spy)
    res = photo_fix.enhance(_jpeg(color=(200, 150, 120)))
    assert "zastąpiono tło jednolitym jasnym" in res.changed
    assert abs(seen["head_h"] - (300 + 360 * 1.02 - 180)) < 1
    im = np.asarray(Image.open(io.BytesIO(res.jpeg)).convert("RGB"))
    assert im[5, 5].min() > 225  # lewy górny róg: jasne, jednolite tło


def test_mask_rejected_when_it_misses_the_face(monkeypatch):
    _fake_face(monkeypatch, [(250, 300, 300, 360)], [(330, 420), (470, 420)])
    monkeypatch.setattr(photo_fix, "_segment", lambda img: np.zeros(img.shape[:2], np.float32))
    res = photo_fix.enhance(_jpeg(color=(200, 150, 120)))
    assert "zastąpiono tło jednolitym jasnym" not in res.changed
    assert any("nie udało się go bezpiecznie zastąpić" in n.text for n in res.notes)
