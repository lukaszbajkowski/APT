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
    # granice komórki tabeli wokół znacznika (najbliższe poziome linie), jeśli są
    box_top: float | None = None
    box_bottom: float | None = None


def _box(
    edges: list[dict], x0: float, x1: float, top: float, bottom: float
) -> tuple[float | None, float | None]:
    above = [e["top"] for e in edges if e["x0"] <= x0 + 1 and e["x1"] >= x0 - 1 and e["top"] <= top + 0.5]
    below = [e["top"] for e in edges if e["x0"] <= x0 + 1 and e["x1"] >= x0 - 1 and e["top"] >= bottom - 0.5]
    t = max(above) if above and top - max(above) < 60 else None
    b = min(below) if below and min(below) - bottom < 60 else None
    return t, b


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
            edges = [e for e in page.edges if e.get("orientation") == "h"]
            # znak w PDF może mieć kilka liter (ligatury „fi”) – mapujemy pozycję w tekście na znak
            text, owner = "", []
            for ci, c in enumerate(chars):
                text += c["text"]
                owner.extend([ci] * len(c["text"]))
            for m in wanted:
                i = text.find(m)
                while i >= 0:
                    a, b = chars[owner[i]], chars[owner[i + len(m) - 1]]
                    bt, bb = _box(edges, a["x0"], b["x1"], a["top"], a["bottom"])
                    out.setdefault(m, []).append(
                        Placement(pi, a["x0"], b["x1"], a["top"], a["bottom"], bt, bb)
                    )
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


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    """Dzieli tekst na linie mieszczące się w szerokości; za długie słowa tnie po znakach."""
    from reportlab.pdfbase.pdfmetrics import stringWidth

    lines: list[str] = []
    for para in (text or "").splitlines() or [""]:
        line = ""
        for word in para.split(" "):
            cand = f"{line} {word}" if line else word
            if stringWidth(cand, font, size) <= width:
                line = cand
                continue
            if line:
                lines.append(line)
            line = ""
            for ch in word:
                if stringWidth(line + ch, font, size) > width and line:
                    lines.append(line)
                    line = ""
                line += ch
        lines.append(line)
    return lines


def _certificate(original_hash: str, doc_title: str, doc_id: str, sigs: list[AppliedSignature]) -> PdfReader:
    regular, bold = _fonts()
    w, h = A4
    left, right, top, bottom = 20 * mm, 20 * mm, 25 * mm, 22 * mm

    def draw(c: canvas.Canvas) -> None:
        y = h - top

        def need(space: float) -> None:
            nonlocal y
            if y - space < bottom:
                footer()
                c.showPage()
                y = h - top

        def text(t: str, font: str, size: float, indent: float = 0, gap: float = 1.45) -> None:
            nonlocal y
            for line in wrap(t, font, size, w - left - right - indent):
                need(size * gap)
                c.setFont(font, size)
                c.drawString(left + indent, y, line)
                y -= size * gap

        def footer() -> None:
            c.setFont(regular, 8)
            c.drawString(
                left, 12 * mm, "Wygenerowano automatycznie w aplikacji Identyfikacja pracowników APT."
            )

        text("Potwierdzenie podpisów elektronicznych", bold, 14, gap=1.8)
        text(f"Dokument: {doc_title}", regular, 9.5)
        text(f"Identyfikator: {doc_id}", regular, 9.5)
        text("Skrót SHA-256 dokumentu przed podpisem:", regular, 9.5)
        text(original_hash, "Courier", 8.5, gap=1.6)
        y -= 3 * mm
        for s in sigs:
            need(30 * mm)  # nagłówek osoby nie zostaje sam na dole strony
            text(f"{SIGN_ROLES.get(s.role, s.role)}: {s.signer_name}", bold, 11, gap=1.6)
            method = {
                "ekran": "podpis złożony na ekranie (zwykły podpis elektroniczny)",
                "zaufany": "podpis zaufany / kwalifikowany – plik dołączony osobno",
                "skan": "podpis odręczny – skan papierowego dokumentu",
            }.get(s.method, s.method)
            for line in (
                f"Data i godzina: {s.signed_at.astimezone(TZ):%d.%m.%Y %H:%M:%S} (czas polski)",
                f"Sposób: {method}",
                f"Adres IP: {s.ip or '—'}",
                f"Urządzenie: {(s.user_agent or '—')[:500]}",
            ):
                text(line, regular, 9.5, indent=4 * mm, gap=1.4)
            if s.image_png:
                need(SIG_H + 2 * mm)
                c.drawImage(ImageReader(io.BytesIO(s.image_png)), left + 4 * mm, y - SIG_H, SIG_W, SIG_H,
                            mask="auto", preserveAspectRatio=True, anchor="sw")  # fmt: skip
                y -= SIG_H + 2 * mm
            y -= 5 * mm
        footer()

    return _overlay(w, h, draw)


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
                        y, h = base - 4, SIG_H
                        if pl.box_top is not None and pl.box_bottom is not None:
                            # podpis mieści się w komórce tabeli (nie wchodzi na nagłówek / sąsiednie wiersze)
                            h = min(SIG_H, max(pl.box_bottom - pl.box_top - 3, 6 * mm))
                            y = ph - (pl.box_top + pl.box_bottom) / 2 - h / 2
                        c.drawImage(ImageReader(io.BytesIO(s.image_png)), x, y, SIG_W, h,
                                    mask="auto", preserveAspectRatio=True, anchor="sw")  # fmt: skip

            page.merge_page(_overlay(pw, ph, draw).pages[0])
        writer.add_page(page)
    for cert in _certificate(sha256(original_pdf), doc_title, doc_id, sigs).pages:
        writer.add_page(cert)
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


def embedded_pdf(xml: bytes) -> bytes | None:
    """Dokument PDF zaszyty w pliku XAdES (gov.pl „podpis otaczający”) – base64 zaczynający się od JVBER."""
    import re

    for m in re.finditer(rb">\s*(JVBER[A-Za-z0-9+/=\s]+?)\s*<", xml):
        try:
            data = base64.b64decode(re.sub(rb"\s+", b"", m.group(1)))
        except ValueError:
            continue
        if data.startswith(b"%PDF"):
            return data
    return None


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
