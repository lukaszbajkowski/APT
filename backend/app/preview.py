"""Podgląd dokumentu w aplikacji: strony jako obrazy PNG ze znakiem wodnym (kto i kiedy ogląda)."""

import io
from datetime import datetime
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


def watermark(img: Image.Image, viewer: str, when: datetime | None = None) -> Image.Image:
    """Ukośny, półprzezroczysty napis powtarzany na całej stronie."""
    when = when or datetime.now(TZ)
    text = f"{viewer} · {when.astimezone(TZ):%d.%m.%Y %H:%M} · tylko podgląd"
    w, h = img.size
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
    out = img.convert("RGBA")
    out.alpha_composite(layer.crop((left, top, left + w, top + h)))
    return out.convert("RGB")


def render_page(data: bytes, ext: str, page: int, viewer: str) -> bytes:
    img = _page_image(data, ext, page)
    if img.width > MAX_W:
        img = img.resize((MAX_W, int(img.height * MAX_W / img.width)))
    img = watermark(img, viewer)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
