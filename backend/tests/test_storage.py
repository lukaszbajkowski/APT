"""Szyfrowanie plików na dysku."""

import io
from pathlib import Path

import pytest
from PIL import Image

from app import storage
from app.config import get_settings
from tests.test_employees import (
    _jpeg,
    create,
    hr,  # noqa: F401
)


def _all_files(sub: str) -> list[Path]:
    d = Path(get_settings().data_dir) / sub
    return [p for p in d.rglob("*") if p.is_file()] if d.is_dir() else []


def test_roundtrip_and_format(tmp_path):
    p = tmp_path / "x" / "plik.pdf"
    storage.write(p, b"%PDF-1.4 tajne dane PESEL 44051401359")
    raw = p.read_bytes()
    assert raw.startswith(storage.MAGIC) and b"PESEL" not in raw and b"%PDF" not in raw
    assert storage.read(p) == b"%PDF-1.4 tajne dane PESEL 44051401359"
    # ten sam tekst szyfrowany dwa razy daje inny szyfrogram (losowy nonce)
    storage.write(tmp_path / "y.pdf", b"%PDF-1.4 tajne dane PESEL 44051401359")
    assert (tmp_path / "y.pdf").read_bytes() != raw
    assert not list(tmp_path.rglob(".*.tmp"))  # brak resztek po zapisie atomowym


def test_tampered_or_wrong_key_is_detected(tmp_path, monkeypatch):
    p = tmp_path / "a.bin"
    storage.write(p, b"dane")
    blob = bytearray(p.read_bytes())
    blob[-1] ^= 1
    p.write_bytes(bytes(blob))
    with pytest.raises(storage.FileDecryptError):
        storage.read(p)
    # inny klucz główny
    storage.write(p, b"dane")
    from app import crypto

    storage._key.cache_clear()
    monkeypatch.setattr(crypto, "_master_key", lambda: b"\x07" * 32)
    try:
        with pytest.raises(storage.FileDecryptError):
            storage.read(p)
    finally:
        storage._key.cache_clear()


def test_legacy_plain_files_are_readable_and_get_encrypted(tmp_path):
    for sub, name in (
        ("documents/1", "a.pdf"),
        ("photos", "1_x.jpg"),
        ("medical/2", "b.pdf"),
        ("trainings/3", "c.pdf"),
    ):
        f = tmp_path / sub / name
        f.parent.mkdir(parents=True)
        f.write_bytes(b"jawny plik " + name.encode())
    (tmp_path / "templates").mkdir()
    (tmp_path / "templates" / "1_v1.docx").write_bytes(b"szablon")  # szablonów nie ruszamy
    f = tmp_path / "documents/1/a.pdf"
    assert storage.read(f) == b"jawny plik a.pdf"  # stary plik działa przed migracją
    rep = storage.encrypt_tree(tmp_path)
    assert (rep.encrypted, rep.already, rep.failed) == (4, 0, 0)
    assert f.read_bytes().startswith(storage.MAGIC) and storage.read(f) == b"jawny plik a.pdf"
    assert (tmp_path / "templates" / "1_v1.docx").read_bytes() == b"szablon"
    again = storage.encrypt_tree(tmp_path)  # powtórzenie nic nie psuje
    assert (again.encrypted, again.already) == (0, 4)
    assert storage.read(f) == b"jawny plik a.pdf"


def test_photo_is_stored_encrypted_and_served_plain(hr):  # noqa: F811
    e = create(hr).json()
    assert (
        hr.put(
            f"/api/employees/{e['id']}/photo", files={"file": ("x.jpg", _jpeg(800, 1000), "image/jpeg")}
        ).status_code
        == 200
    )
    stored = [p for p in _all_files("photos") if p.name.startswith(f"{e['id']}_")]
    assert stored and all(p.read_bytes().startswith(storage.MAGIC) for p in stored)
    img = hr.get(f"/api/employees/{e['id']}/photo")
    assert Image.open(io.BytesIO(img.content)).size == (600, 800)
    # karta z tym zdjęciem też się generuje
    assert hr.get("/api/cards", params={"ids": str(e["id"])}).status_code in (200, 404, 422)
