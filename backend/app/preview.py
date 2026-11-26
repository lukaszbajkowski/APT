"""Podgląd dokumentu w aplikacji: strony jako obrazy PNG ze znakiem wodnym (kto i kiedy ogląda)."""

import io
from datetime import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

from app.cards import FONT_DIR

TZ = ZoneInfo("Europe/Warsaw")
SCALE = 1.7  # ~122 dpi – czytelnie na ekranie, za słabo na porządny wydruk
MAX_W = 1400


def page_count(data: bytes, ext: str) -> int:
    if ext != "pdf":
        return 1
    from app import pdfium_safe

    return pdfium_safe.page_count(data)


def _page_image(data: bytes, ext: str, page: int) -> Image.Image:
    if ext != "pdf":
        if page != 0:
            raise IndexError(page)
        img = Image.open(io.BytesIO(data))
        img.load()
        return img.convert("RGB")
    from app import pdfium_safe

    # pola formularza, w tym widoczny podpis z gov.pl / podpisu kwalifikowanego
    img = pdfium_safe.page_image(data, page, SCALE, forms=True)
    if img is None:
        raise IndexError(page)
    return img


@lru_cache(maxsize=8)  # ~6 MB na warstwę – najwyżej ~46 MB
def _watermark_layer(w: int, h: int, text: str) -> Image.Image:
    """Gotowa warstwa znaku wodnego dla rozmiaru strony i napisu (osoba + minuta). Rysowanie i obrót trwają
    ~300 ms, a kolejne strony dokumentu mają zwykle ten sam rozmiar – warstwa jest więc liczona raz.
    Zwracany obraz jest tylko do odczytu (alpha_composite nie zmienia warstwy)."""
    size = max(14, w // 55)
    font = ImageFont.truetype(str(FONT_DIR / "IBMPlexSans-Medium.ttf"), size)
    tw = int(font.getlength(text)) + size * 4
    th = size * 7
    diag = int((w**2 + h**2) ** 0.5)
    layer = Image.new("RGBA", (diag, diag), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for row, y in enumerate(range(0, diag, th)):
        off = (row % 2) * tw // 2
        for x in range(-tw, diag, tw):
            d.text((x + off, y), text, font=font, fill=(40, 60, 120, 46))
    layer = layer.rotate(30, resample=Image.BICUBIC)
    left, top = (diag - w) // 2, (diag - h) // 2
    return layer.crop((left, top, left + w, top + h))


def watermark(img: Image.Image, viewer: str, when: datetime | None = None) -> Image.Image:
    """Ukośny, półprzezroczysty napis powtarzany na całej stronie."""
    when = when or datetime.now(TZ)
    text = f"{viewer} · {when.astimezone(TZ):%d.%m.%Y %H:%M} · tylko podgląd"
    out = img.convert("RGBA")
    out.alpha_composite(_watermark_layer(img.width, img.height, text))
    return out.convert("RGB")


def render_page(data: bytes, ext: str, page: int, viewer: str, mark: bool = True) -> bytes:
    img = _page_image(data, ext, page)
    if img.width > MAX_W:
        img = img.resize((MAX_W, int(img.height * MAX_W / img.width)))
    if mark:  # pliki z wiadomości – bez znaku wodnego (korespondencja, nie dokument firmy)
        img = watermark(img, viewer)
    buf = io.BytesIO()
    # zwykła kompresja: optimize=True liczy ~4× dłużej, a plik wychodzi tej samej wielkości (test
    # obciążenia, 11.2026)
    img.save(buf, "PNG", compress_level=6)
    return buf.getvalue()
