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
try:  # zdjęcia HEIC / HEIF z iPhone'a – zamieniane na JPG
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover – bez biblioteki HEIC jest odrzucany z komunikatem
    pass

AUDIO = {
    # rozszerzenie: (typ MIME, sprawdzenie nagłówka)
    "m4a": "audio/mp4",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
    "wav": "audio/wav",
    "webm": "audio/webm",
    "aac": "audio/aac",
}
TEXT_MAX = 512 * 1024
TABLE_ROWS, TABLE_COLS = 2000, 60


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
    audio = _audio(base, raw)
    if audio:
        return audio
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise FileError(f"Pliku „{name}” nie da się wysłać. {ALLOWED_TEXT}") from exc
    if fmt not in ("JPEG", "PNG", "WEBP", "MPO", "HEIF"):
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
    "odp": ("application/vnd.oasis.opendocument.presentation", b"PK\x03\x04"),
    "rtf": ("application/rtf", b"{\\rtf"),
    "txt": ("text/plain", b""),
    "csv": ("text/csv", b""),
}
ALLOWED_TEXT = (
    "Dozwolone są zdjęcia, PDF, Word, Excel, PowerPoint, OpenDocument, TXT, CSV i nagrania głosowe."
)


def _audio(name: str, raw: bytes) -> Prepared | None:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    head = raw[:16]
    sniff = (
        "m4a"
        if head[4:8] == b"ftyp"
        else "mp3"
        if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
        else "ogg"
        if head.startswith(b"OggS")
        else "wav"
        if head.startswith(b"RIFF") and raw[8:12] == b"WAVE"
        else "webm"
        if head.startswith(b"\x1a\x45\xdf\xa3")
        else "aac"
        if head[:2] in (b"\xff\xf1", b"\xff\xf9")
        else None
    )
    if ext not in AUDIO and not (sniff and ext in ("", "mp4", "caf")):
        return None
    if sniff is None:
        raise FileError(f"Plik „{name}” nie wygląda na nagranie.")
    if ext == "opus" and sniff == "ogg":
        sniff = "opus"
    if ext in ("mp4", "m4a", "") and sniff == "m4a":
        sniff = "m4a"
    return Prepared(name, sniff, AUDIO[sniff], raw)


def text_of(raw: bytes) -> str:
    data = raw[:TEXT_MAX]
    for enc in ("utf-8-sig", "cp1250"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def table_of(thread_id: int, file_name: str) -> list[dict]:
    """Arkusze jako tabele do podglądu: CSV wprost, XLSX przez openpyxl, XLS / ODS przez LibreOffice."""
    import csv

    ext = file_name.rsplit(".", 1)[-1]
    raw = read(thread_id, file_name)
    if ext == "csv":
        text = text_of(raw)
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = [
            r[:TABLE_COLS]
            for _, r in zip(range(TABLE_ROWS), csv.reader(io.StringIO(text), dialect), strict=False)
        ]
        return [{"name": "CSV", "rows": rows, "more": len(text.splitlines()) > TABLE_ROWS}]
    if ext != "xlsx":
        d = thread_dir(thread_id)
        cached = d / f"{file_name.split('.')[0]}_x.xlsx"
        if cached.exists():
            raw = storage.read(cached)
        else:
            raw = _convert(raw, ext, "xlsx")
            storage.write(cached, raw)
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets[:20]:
        rows, more = [], False
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= TABLE_ROWS:
                more = True
                break
            rows.append([_cell(v) for v in row[:TABLE_COLS]])
        while rows and not any(rows[-1]):
            rows.pop()
        width = max(
            (len(r) - next((k for k, v in enumerate(reversed(r)) if v), len(r)) for r in rows), default=0
        )
        out.append({"name": ws.title, "rows": [r[:width] for r in rows], "more": more})
    wb.close()
    return out


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return (f"{v:.10g}").replace(".", ",")
    if hasattr(v, "strftime"):
        return (
            v.strftime("%d.%m.%Y %H:%M")
            if getattr(v, "hour", 0) or getattr(v, "minute", 0)
            else v.strftime("%d.%m.%Y")
        )
    return str(v)


def _convert(raw: bytes, ext: str, to: str) -> bytes:
    """Konwersja LibreOffice do innego formatu (np. XLS → XLSX)."""
    import os
    import subprocess
    import tempfile

    from app import templating

    exe = templating.soffice_path()
    if not exe:
        raise templating.PdfUnavailable("Na serwerze nie ma LibreOffice.")
    with templating._soffice_lock, tempfile.TemporaryDirectory(prefix="apt-conv-") as tmp:
        src = Path(tmp) / f"plik.{ext}"
        src.write_bytes(raw)
        cmd = [exe, f"-env:UserInstallation=file://{Path(tmp) / 'profile'}", "--headless", "--norestore"]
        cmd += ["--convert-to", to, "--outdir", tmp, str(src)]
        try:
            subprocess.run(cmd, check=True, timeout=90, capture_output=True, env={**os.environ, "HOME": tmp})
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise templating.PdfUnavailable("Konwersja pliku nie powiodła się.") from exc
        out = Path(tmp) / f"plik.{to}"
        if not out.exists():
            raise templating.PdfUnavailable("Konwersja pliku nie powiodła się.")
        return out.read_bytes()


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
