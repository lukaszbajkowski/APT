"""Podpis na ekranie: odnalezienie miejsca podpisu w PDF, naniesienie podpisu i daty, strona potwierdzenia.

Szablon zawiera {{ podpis_pracownika }} / {{ data_podpisu_pracownika }} – w PDF stoją tam niewidoczne
znaczniki (biały tekst). Po podpisie nakładamy na nie obraz podpisu i datę, a na końcu dokumentu
dodajemy stronę z potwierdzeniem: kto, kiedy, skąd, skrót SHA-256 dokumentu źródłowego.
"""

import base64
import hashlib
import io
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import pdfplumber
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.templating import SIGN_ROLES, sign_marker

TZ = ZoneInfo("Europe/Warsaw")
SIG_W, SIG_H = 42 * mm, 14 * mm
MAX_IMAGE = 2 * 1024 * 1024


class SignatureError(ValueError):
    pass


@dataclass
class Placement:
    page: int
    x0: float
    x1: float
    top: float
    bottom: float


@dataclass
class AppliedSignature:
    role: str
    signer_name: str
    signed_at: datetime
    method: str  # ekran | zaufany | skan
    image_png: bytes | None = None
    ip: str | None = None
    user_agent: str | None = None


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def find_markers(pdf: bytes) -> dict[str, list[Placement]]:
    wanted = [sign_marker(k, r) for r in SIGN_ROLES for k in ("SIG", "DATE")]
    out: dict[str, list[Placement]] = {}
    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        for pi, page in enumerate(doc.pages):
            chars = page.chars
            # znak w PDF może mieć kilka liter (ligatury „fi”) – mapujemy pozycję w tekście na znak
            text, owner = "", []
            for ci, c in enumerate(chars):
                text += c["text"]
                owner.extend([ci] * len(c["text"]))
            for m in wanted:
                i = text.find(m)
                while i >= 0:
                    a, b = chars[owner[i]], chars[owner[i + len(m) - 1]]
                    out.setdefault(m, []).append(Placement(pi, a["x0"], b["x1"], a["top"], a["bottom"]))
                    i = text.find(m, i + len(m))
    return out


def roles_in_pdf(pdf: bytes) -> list[str]:
    found = find_markers(pdf)
    return [r for r in SIGN_ROLES if sign_marker("SIG", r) in found]


def decode_signature(data_url: str) -> bytes:
    """Obraz z pola podpisu (data:image/png;base64,...) → PNG z przezroczystym tłem, przycięty."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    try:
        raw = base64.b64decode(data_url, validate=True)
    except ValueError as exc:
        raise SignatureError("Nieprawidłowy obraz podpisu.") from exc
    if len(raw) > MAX_IMAGE:
        raise SignatureError("Obraz podpisu jest za duży.")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001
        raise SignatureError("Nieprawidłowy obraz podpisu.") from exc
    bbox = img.getchannel("A").getbbox()
    if bbox is None:
        raise SignatureError("Pole podpisu jest puste.")
    x0, y0, x1, y1 = bbox
    if (x1 - x0) < 30 or (y1 - y0) < 8:
        raise SignatureError("Podpis jest za mały – podpisz się wyraźniej.")
    img = img.crop(bbox)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _fonts() -> tuple[str, str]:
    from app.cards import _register_fonts

    _register_fonts()
    return "Plex", "Plex-SemiBold"


def _overlay(width: float, height: float, draw) -> PdfReader:  # noqa: ANN001
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    draw(c)
    c.save()
    return PdfReader(io.BytesIO(buf.getvalue()))


def _certificate(original_hash: str, doc_title: str, doc_id: str, sigs: list[AppliedSignature]) -> PdfReader:
    regular, bold = _fonts()

    def draw(c: canvas.Canvas) -> None:
        w, h = A4
        y = h - 25 * mm
        c.setFont(bold, 14)
        c.drawString(20 * mm, y, "Potwierdzenie podpisów elektronicznych")
        y -= 9 * mm
        c.setFont(regular, 9.5)
        for line in (
            f"Dokument: {doc_title}",
            f"Identyfikator: {doc_id}",
            "Skrót SHA-256 dokumentu przed podpisem:",
        ):
            c.drawString(20 * mm, y, line)
            y -= 5.5 * mm
        c.setFont("Courier", 8.5)
        c.drawString(20 * mm, y + 1 * mm, original_hash)
        y -= 5 * mm
        y -= 4 * mm
        for s in sigs:
            c.setFont(bold, 11)
            c.drawString(20 * mm, y, f"{SIGN_ROLES.get(s.role, s.role)}: {s.signer_name}")
            y -= 5.5 * mm
            c.setFont(regular, 9.5)
            method = {
                "ekran": "podpis złożony na ekranie (zwykły podpis elektroniczny)",
                "zaufany": "podpis zaufany / kwalifikowany – plik dołączony osobno",
                "skan": "podpis odręczny – skan papierowego dokumentu",
            }.get(s.method, s.method)
            for line in (
                f"Data i godzina: {s.signed_at.astimezone(TZ):%d.%m.%Y %H:%M:%S} (czas polski)",
                f"Sposób: {method}",
                f"Adres IP: {s.ip or '—'}",
                f"Urządzenie: {(s.user_agent or '—')[:110]}",
            ):
                c.drawString(24 * mm, y, line)
                y -= 5 * mm
            if s.image_png:
                c.drawImage(ImageReader(io.BytesIO(s.image_png)), 24 * mm, y - SIG_H, SIG_W, SIG_H,
                            mask="auto", preserveAspectRatio=True, anchor="sw")  # fmt: skip
                y -= SIG_H + 2 * mm
            y -= 5 * mm
        c.setFont(regular, 8)
        c.drawString(
            20 * mm, 15 * mm, "Wygenerowano automatycznie w aplikacji Identyfikacja pracowników APT."
        )

    return _overlay(*A4, draw)


def stamp(original_pdf: bytes, sigs: list[AppliedSignature], doc_title: str, doc_id: str) -> bytes:
    """Nanosi podpisy z ekranu w miejsca znaczników, dopisuje datę i stronę potwierdzenia."""
    found = find_markers(original_pdf)
    regular, _ = _fonts()
    reader = PdfReader(io.BytesIO(original_pdf))
    writer = PdfWriter()
    for pi, page in enumerate(reader.pages):
        pw, ph = float(page.mediabox.width), float(page.mediabox.height)
        todo: list[tuple[str, Placement, AppliedSignature]] = []
        for s in sigs:
            for kind in ("DATE", "SIG"):
                for pl in found.get(sign_marker(kind, s.role), []):
                    if pl.page == pi:
                        todo.append((kind, pl, s))
        if todo:

            def draw(c: canvas.Canvas, todo=todo, ph=ph, pw=pw) -> None:  # noqa: ANN001
                date_end: dict[tuple[str, float], float] = {}
                for kind, pl, s in sorted(todo, key=lambda t: t[0]):  # DATE przed SIG
                    base = ph - pl.bottom
                    if kind == "DATE":
                        text = s.signed_at.astimezone(TZ).strftime("%d.%m.%Y")
                        c.setFont(regular, 10)
                        c.drawString(pl.x0, base + 1, text)
                        date_end[(s.role, round(pl.top))] = pl.x0 + c.stringWidth(text, regular, 10) + 6
                    elif s.image_png:
                        x = max(pl.x0, date_end.get((s.role, round(pl.top)), 0))
                        x = min(x, pw - SIG_W - 10)
                        c.drawImage(ImageReader(io.BytesIO(s.image_png)), x, base - 4, SIG_W, SIG_H,
                                    mask="auto", preserveAspectRatio=True, anchor="sw")  # fmt: skip

            page.merge_page(_overlay(pw, ph, draw).pages[0])
        writer.add_page(page)
    writer.add_page(_certificate(sha256(original_pdf), doc_title, doc_id, sigs).pages[0])
    writer.add_metadata({"/Title": doc_title, "/Producer": "Identyfikacja pracowników APT"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def looks_signed(data: bytes, filename: str) -> bool:
    """Wstępne sprawdzenie pliku podpisanego podpisem zaufanym / kwalifikowanym (bez weryfikacji ważności)."""
    name = filename.lower()
    if data[:4] == b"%PDF":
        return b"/ByteRange" in data and (b"/Sig" in data or b"adbe.pkcs7" in data or b"ETSI.CAdES" in data)
    if name.endswith((".xml", ".xades")) or data.lstrip()[:5] == b"<?xml":
        return b"Signature" in data and b"SignatureValue" in data
    return False


def render_pages(pdf: bytes, scale: float = 1.6) -> list[bytes]:
    """Strony PDF jako PNG (podgląd na stronie podpisu – telefony słabo wyświetlają PDF)."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(pdf)
    out = []
    for i in range(len(doc)):
        img = doc[i].render(scale=scale).to_pil()
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "PNG", optimize=True)
        out.append(buf.getvalue())
    doc.close()
    return out
