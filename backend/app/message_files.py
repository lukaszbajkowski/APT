"""Pliki w wiadomościach „Napisz do kadr”: sprawdzenie, obróbka zdjęć i zapis szyfrowany.

Zdjęcia (JPG / PNG / WebP / HEIC przekonwertowany przez telefon) – obrót wg EXIF, bez metadanych,
pomniejszenie do 2000 px (JPEG) i miniatura 480 px do dymka. PDF i pliki biurowe (Word, Excel, PowerPoint,
OpenDocument, TXT, CSV) – bez zmian; podgląd stron jak przy dokumentach (pliki biurowe przez LibreOffice,
PDF podglądu zapisywany obok: <id>_p.pdf). Do 15 MB na plik, do 10 plików.
"""

import io
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app import storage
from app.config import get_settings

MAX_FILES = 10
MAX_MB = 15
BIG, THUMB = 2000, 480
Image.MAX_IMAGE_PIXELS = 40_000_000


class FileError(ValueError):
    pass


@dataclass
class Prepared:
    name: str
    ext: str
    content_type: str
    data: bytes
    thumb: bytes | None = None
    width: int | None = None
    height: int | None = None


def thread_dir(thread_id: int) -> Path:
    p = Path(get_settings().data_dir) / "messages" / str(thread_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def remove_thread(thread_id: int) -> None:
    shutil.rmtree(Path(get_settings().data_dir) / "messages" / str(thread_id), ignore_errors=True)


def _jpeg(img: Image.Image, side: int, quality: int) -> bytes:
    im = img.copy()
    im.thumbnail((side, side), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def prepare(name: str, raw: bytes) -> Prepared:
    if len(raw) > MAX_MB * 1024 * 1024:
        raise FileError(f"Plik „{name}” jest za duży (max {MAX_MB} MB).")
    base = (name or "plik").replace("/", "_").replace("\\", "_")[:200]
    if raw.startswith(b"%PDF"):
        return Prepared(base, "pdf", "application/pdf", raw)
    office = _office(base, raw)
    if office:
        return office
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise FileError(f"Pliku „{name}” nie da się wysłać. {ALLOWED_TEXT}") from exc
    if fmt not in ("JPEG", "PNG", "WEBP", "MPO"):
        raise FileError(f"Pliku „{name}” nie da się wysłać. {ALLOWED_TEXT}")
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    data = _jpeg(img, BIG, 85)
    w, h = Image.open(io.BytesIO(data)).size
    stem = base.rsplit(".", 1)[0] if "." in base else base
    return Prepared(f"{stem}.jpg", "jpg", "image/jpeg", data, _jpeg(img, THUMB, 80), w, h)


OFFICE = {
    # rozszerzenie: (typ MIME, sygnatura pliku)
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", b"PK\x03\x04"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b"PK\x03\x04"),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", b"PK\x03\x04"),
    "odt": ("application/vnd.oasis.opendocument.text", b"PK\x03\x04"),
    "ods": ("application/vnd.oasis.opendocument.spreadsheet", b"PK\x03\x04"),
    "doc": ("application/msword", b"\xd0\xcf\x11\xe0"),
    "xls": ("application/vnd.ms-excel", b"\xd0\xcf\x11\xe0"),
    "ppt": ("application/vnd.ms-powerpoint", b"\xd0\xcf\x11\xe0"),
    "rtf": ("application/rtf", b"{\\rtf"),
    "txt": ("text/plain", b""),
    "csv": ("text/csv", b""),
}
ALLOWED_TEXT = "Dozwolone są zdjęcia, PDF, Word, Excel, PowerPoint, OpenDocument, TXT i CSV."


def _office(name: str, raw: bytes) -> Prepared | None:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in OFFICE:
        return None
    ctype, sig = OFFICE[ext]
    if sig and not raw.startswith(sig):
        raise FileError(f"Plik „{name}” nie wygląda na prawdziwy plik .{ext}.")
    if not sig:
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError:
            try:
                raw.decode("cp1250")
            except UnicodeDecodeError as exc:
                raise FileError(f"Plik „{name}” nie jest plikiem tekstowym.") from exc
        if b"\x00" in raw:
            raise FileError(f"Plik „{name}” nie jest plikiem tekstowym.")
    return Prepared(name, ext, ctype, raw)


def preview_source(thread_id: int, file_name: str, content_type: str) -> tuple[bytes, str]:
    """Dane do podglądu stron: PDF i zdjęcia wprost, pliki biurowe – PDF z LibreOffice (zapamiętany obok)."""
    ext = file_name.rsplit(".", 1)[-1]
    data = read(thread_id, file_name)
    if ext in ("pdf", "jpg"):
        return data, ext
    from app import templating

    d = thread_dir(thread_id)
    cached = d / f"{file_name.split('.')[0]}_p.pdf"
    if cached.exists():
        return storage.read(cached), "pdf"
    pdf = templating.to_pdf(data, suffix=ext)
    storage.write(cached, pdf)
    return pdf, "pdf"


def write(thread_id: int, file_id: int, p: Prepared) -> str:
    fn = f"{file_id}.{p.ext}"
    d = thread_dir(thread_id)
    storage.write(d / fn, p.data)
    if p.thumb:
        storage.write(d / f"{file_id}_t.jpg", p.thumb)
    return fn


def read(thread_id: int, file_name: str, thumb: bool = False) -> bytes:
    d = thread_dir(thread_id)
    path = d / (f"{file_name.split('.')[0]}_t.jpg" if thumb else file_name)
    if not path.exists():
        path = d / file_name
    return storage.read(path)
