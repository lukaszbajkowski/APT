"""Karty identyfikacyjne w PDF – wariant A (granatowy pasek u góry, zdjęcie z lewej, QR z prawej).

Format karty CR80: 85,6 × 54 mm. Dwa układy wydruku:
- "cr80": jedna karta na stronę o wymiarach karty (drukarki kart PVC),
- "a4":   10 kart na arkuszu A4 (2 × 5) ze znacznikami cięcia.
"""

import io
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

from app import storage

CARD_W = 85.6 * mm
CARD_H = 54.0 * mm
CORNER = 3.18 * mm

NAVY = HexColor("#1F3A73")
INK = HexColor("#141B2D")
MUTED = HexColor("#5B6577")
BAR_MUTED = HexColor("#C9D3E6")
PHOTO_BG = HexColor("#E9EDF4")
PHOTO_FG = HexColor("#C3CCDB")
CUT = HexColor("#9AA3B2")

FONT_DIR = Path(__file__).parent / "assets" / "fonts"
_FONTS = {
    "Plex": "IBMPlexSans-Regular.ttf",
    "Plex-Medium": "IBMPlexSans-Medium.ttf",
    "Plex-SemiBold": "IBMPlexSans-SemiBold.ttf",
    "Plex-Bold": "IBMPlexSans-Bold.ttf",
    "PlexMono-SemiBold": "IBMPlexMono-SemiBold.ttf",
}
_registered = False


def _register_fonts() -> None:
    global _registered
    if _registered:
        return
    for name, file in _FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))
    _registered = True


@dataclass
class CardData:
    number: str  # "004217"
    first_name: str
    last_name: str
    agency: str | None
    department: str | None
    photo: Path | None


def _fit(text: str, font: str, size: float, max_w: float, min_size: float) -> tuple[str, float]:
    """Zmniejsza czcionkę do min_size, a gdy dalej się nie mieści – skraca tekst wielokropkiem."""
    while size > min_size and pdfmetrics.stringWidth(text, font, size) > max_w:
        size -= 0.25
    if pdfmetrics.stringWidth(text, font, size) <= max_w:
        return text, size
    while text and pdfmetrics.stringWidth(text + "…", font, size) > max_w:
        text = text[:-1]
    return text.rstrip() + "…", size


def _spaced(c: Canvas, x: float, y: float, text: str, font: str, size: float, spacing: float) -> None:
    t = c.beginText(x, y)
    t.setFont(font, size)
    t.setCharSpace(spacing)
    t.textOut(text)
    t.setCharSpace(0)  # odstęp liter w PDF jest stanem grafiki – bez resetu przechodzi na kolejne napisy
    c.drawText(t)


def _spaced_width(text: str, font: str, size: float, spacing: float) -> float:
    return pdfmetrics.stringWidth(text, font, size) + spacing * max(len(text) - 1, 0)


def _photo(c: Canvas, x: float, y: float, w: float, h: float, path: Path | None) -> None:
    c.saveState()
    clip = c.beginPath()
    clip.roundRect(x, y, w, h, 1.0 * mm)
    c.clipPath(clip, stroke=0, fill=0)
    drawn = False
    if path is not None and path.exists():
        try:
            c.drawImage(ImageReader(io.BytesIO(storage.read(path))), x, y, w, h, preserveAspectRatio=False)
            drawn = True
        except OSError:
            drawn = False
    if not drawn:
        c.setFillColor(PHOTO_BG)
        c.rect(x, y, w, h, stroke=0, fill=1)
        c.setFillColor(PHOTO_FG)
        c.circle(x + w / 2, y + h * 0.62, w * 0.24, stroke=0, fill=1)
        c.roundRect(x + w * 0.08, y - h * 0.15, w * 0.84, h * 0.5, w * 0.35, stroke=0, fill=1)
    c.restoreState()


def _qr(c: Canvas, x: float, y: float, size: float, value: str) -> None:
    widget = QrCodeWidget(value, barLevel="M", barBorder=0)
    x0, y0, x1, y1 = widget.getBounds()
    d = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    widget.barFillColor = INK
    widget.barStrokeColor = INK
    d.add(widget)
    renderPDF.draw(d, c, x, y)


def draw_card(c: Canvas, ox: float, oy: float, card: CardData, valid_until: date | None) -> None:
    """Rysuje jedną kartę z lewym dolnym rogiem w (ox, oy)."""
    c.saveState()
    clip = c.beginPath()
    clip.roundRect(ox, oy, CARD_W, CARD_H, CORNER)
    c.clipPath(clip, stroke=0, fill=0)

    c.setFillColor(white)
    c.rect(ox, oy, CARD_W, CARD_H, stroke=0, fill=1)

    # Pasek u góry
    bar_h = 9.2 * mm
    pad = 4.4 * mm
    c.setFillColor(NAVY)
    c.rect(ox, oy + CARD_H - bar_h, CARD_W, bar_h, stroke=0, fill=1)
    c.setFillColor(white)
    _spaced(
        c, ox + pad, oy + CARD_H - bar_h / 2 - 2.1, "IDENTYFIKATOR PRACOWNIKA", "Plex-SemiBold", 6.4, 1.05
    )
    if valid_until is not None:
        right = ox + CARD_W - pad
        label = "WAŻNA DO"
        c.setFillColor(BAR_MUTED)
        lw = _spaced_width(label, "Plex-Medium", 3.9, 0.35)
        _spaced(c, right - lw, oy + CARD_H - bar_h / 2 + 1.2, label, "Plex-Medium", 3.9, 0.35)
        c.setFillColor(white)
        c.setFont("Plex-SemiBold", 6.0)
        c.drawRightString(right, oy + CARD_H - bar_h / 2 - 4.6, valid_until.strftime("%d.%m.%Y"))

    # Zdjęcie 3:4, wyśrodkowane w pionie pod paskiem
    ph_h = 34.0 * mm
    body_top = oy + CARD_H - bar_h - (CARD_H - bar_h - ph_h) / 2
    ph_w = ph_h * 3 / 4
    _photo(c, ox + pad, body_top - ph_h, ph_w, ph_h, card.photo)

    # QR + numer
    qr = 16.0 * mm
    qr_x = ox + CARD_W - pad - qr
    num_y = body_top - ph_h + 0.6 * mm
    c.setFillColor(INK)
    c.setFont("PlexMono-SemiBold", 7.6)
    c.drawCentredString(qr_x + qr / 2, num_y, card.number)
    _qr(c, qr_x, num_y + 3.6 * mm, qr, card.number)

    # Tekst
    tx = ox + pad + ph_w + 4.0 * mm
    tw = qr_x - 2.5 * mm - tx
    c.setFillColor(INK)
    # Nazwisko: jedna linia, a gdy za długie (np. dwuczłonowe) – dwie linie zamiast obcinania.
    surname = card.last_name.upper()
    lines = [surname]
    size = 13.0
    while size > 9.0 and pdfmetrics.stringWidth(surname, "Plex-Bold", size) > tw:
        size -= 0.25
    if pdfmetrics.stringWidth(surname, "Plex-Bold", size) > tw:
        sep = "-" if "-" in surname else " " if " " in surname else None
        if sep:
            head, tail = surname.split(sep, 1)
            lines = [head + ("-" if sep == "-" else ""), tail]
            size = 11.0
            while size > 7.0 and max(pdfmetrics.stringWidth(x, "Plex-Bold", size) for x in lines) > tw:
                size -= 0.25
        lines = [_fit(x, "Plex-Bold", size, tw, 6.5)[0] for x in lines]
        size = min(_fit(x, "Plex-Bold", size, tw, 6.5)[1] for x in lines)
    c.setFont("Plex-Bold", size)
    y = body_top - 4.4 * mm
    for line in lines:
        c.drawString(tx, y, line)
        y -= size * 1.12
    shift = (len(lines) - 1) * size * 1.12
    text, size = _fit(card.first_name, "Plex-Medium", 10.5, tw, 7.5)
    c.setFont("Plex-Medium", size)
    c.drawString(tx, body_top - 9.2 * mm - shift, text)

    y = body_top - 17.2 * mm - shift
    for label, value in (("AGENCJA", card.agency), ("WYDZIAŁ", card.department)):
        c.setFillColor(MUTED)
        _spaced(c, tx, y, label, "Plex-Medium", 4.6, 0.45)
        c.setFillColor(INK)
        text, size = _fit(value or "—", "Plex-Medium", 6.9, tw, 5.2)
        c.setFont("Plex-Medium", size)
        c.drawString(tx, y - 2.7 * mm, text)
        y -= 7.0 * mm

    c.restoreState()


def _crop_marks(
    c: Canvas, xs: list[float], ys: list[float], left: float, right: float, bottom: float, top: float
) -> None:
    c.setStrokeColor(CUT)
    c.setLineWidth(0.3)
    gap, length = 1.5 * mm, 5 * mm
    for x in xs:
        c.line(x, top + gap, x, top + gap + length)
        c.line(x, bottom - gap, x, bottom - gap - length)
    for y in ys:
        c.line(left - gap, y, left - gap - length, y)
        c.line(right + gap, y, right + gap + length, y)


def render(cards: list[CardData], layout: str = "a4", valid_until: date | None = None) -> bytes:
    _register_fonts()
    buf = io.BytesIO()
    if layout == "cr80":
        c = Canvas(buf, pagesize=(CARD_W, CARD_H))
        c.setTitle("Karty identyfikacyjne")
        for card in cards:
            draw_card(c, 0, 0, card, valid_until)
            c.showPage()
        c.save()
        return buf.getvalue()

    cols, rows = 2, 5
    page_w, page_h = A4
    grid_w, grid_h = cols * CARD_W, rows * CARD_H
    left = (page_w - grid_w) / 2
    bottom = (page_h - grid_h) / 2
    c = Canvas(buf, pagesize=A4)
    c.setTitle("Karty identyfikacyjne")
    per_page = cols * rows
    for start in range(0, len(cards), per_page):
        chunk = cards[start : start + per_page]
        for i, card in enumerate(chunk):
            col, row = i % cols, i // cols
            x = left + col * CARD_W
            y = bottom + grid_h - (row + 1) * CARD_H
            draw_card(c, x, y, card, valid_until)
            # Delikatny obrys = linia cięcia (zaokrąglone rogi docina się zaokrąglarką albo zostają proste).
            c.setStrokeColor(CUT)
            c.setLineWidth(0.25)
            c.roundRect(x, y, CARD_W, CARD_H, CORNER, stroke=1, fill=0)
        used_rows = (len(chunk) + cols - 1) // cols
        xs = [left + i * CARD_W for i in range(cols + 1)]
        ys = [bottom + grid_h - i * CARD_H for i in range(used_rows + 1)]
        _crop_marks(c, xs, ys, left, left + grid_w, ys[-1], bottom + grid_h)
        c.showPage()
    c.save()
    return buf.getvalue()
