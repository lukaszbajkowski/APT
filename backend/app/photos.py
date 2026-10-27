"""Przetwarzanie i zapis zdjęć pracowników.

Każde zdjęcie jest normalizowane: obrót wg EXIF, usunięcie metadanych, przycięcie do 3:4,
pomniejszenie do maks. 600×800 i zapis jako JPEG do ok. 200 KB.
"""

import io
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app import storage
from app.config import get_settings

TARGET_W, TARGET_H = 600, 800
MAX_BYTES = 200 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000  # ochrona przed "bombami" pikselowymi


class PhotoError(ValueError):
    pass


@dataclass
class ProcessedPhoto:
    data: bytes
    width: int
    height: int


def photos_dir() -> Path:
    path = Path(get_settings().data_dir) / "photos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def process(raw: bytes) -> ProcessedPhoto:
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise PhotoError("Plik nie jest obsługiwanym obrazem (JPG, PNG, WebP).") from exc
    if img.format not in (None, "JPEG", "PNG", "WEBP", "MPO"):
        raise PhotoError("Obsługiwane formaty: JPG, PNG, WebP.")
    if min(img.size) < 120:
        raise PhotoError("Zdjęcie jest za małe (minimum 120 px).")

    img = img.convert("RGB")
    # Przycięcie do proporcji 3:4 (środek), potem pomniejszenie.
    img = (
        ImageOps.fit(img, (TARGET_W, TARGET_H), method=Image.Resampling.LANCZOS)
        if (img.width >= TARGET_W and img.height >= TARGET_H)
        else _fit_small(img)
    )

    for quality in (88, 82, 76, 70, 62, 55):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
        if buf.tell() <= MAX_BYTES:
            break
    return ProcessedPhoto(data=buf.getvalue(), width=img.width, height=img.height)


def _fit_small(img: Image.Image) -> Image.Image:
    """Małe zdjęcie: tylko przycięcie do 3:4, bez powiększania."""
    w, h = img.size
    if w * 4 > h * 3:  # za szerokie
        new_w = h * 3 // 4
        left = (w - new_w) // 2
        return img.crop((left, 0, left + new_w, h))
    new_h = w * 4 // 3
    top = (h - new_h) // 2
    return img.crop((0, top, w, top + new_h))


def save(employee_id: int, photo: ProcessedPhoto) -> str:
    name = f"{employee_id}_{uuid.uuid4().hex}.jpg"
    path = photos_dir() / name
    storage.write(path, photo.data)
    return name


def path_for(file_name: str) -> Path:
    # file_name pochodzi z bazy, ale i tak pilnujemy, żeby nie wyjść poza katalog.
    if "/" in file_name or "\\" in file_name or file_name.startswith("."):
        raise PhotoError("Nieprawidłowa nazwa pliku.")
    return photos_dir() / file_name


def delete(file_name: str) -> None:
    try:
        path_for(file_name).unlink(missing_ok=True)
    except PhotoError:
        pass
