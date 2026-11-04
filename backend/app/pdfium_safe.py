"""Bezpieczne użycie pdfium: biblioteka NIE jest wielowątkowa.

FastAPI wykonuje zwykłe (synchroniczne) endpointy w puli wątków, a przeglądarka prosi o kilka stron
dokumentu naraz – równoległe wywołania pdfium kończyły się awarią całego procesu API (segfault).
Każde otwarcie i renderowanie PDF przechodzi więc przez jedną blokadę; kodowanie PNG jest już poza nią.
"""

import io
import threading

from PIL import Image

LOCK = threading.RLock()


def page_count(data: bytes) -> int:
    import pypdfium2 as pdfium

    with LOCK:
        doc = pdfium.PdfDocument(data)
        try:
            return len(doc)
        finally:
            doc.close()


def page_image(data: bytes, n: int, scale: float, forms: bool = False) -> Image.Image | None:
    """Strona jako obraz RGB albo None, gdy takiej strony nie ma."""
    import pypdfium2 as pdfium

    with LOCK:
        doc = pdfium.PdfDocument(data)
        try:
            if forms:
                doc.init_forms()  # pola formularza, np. widoczny podpis z gov.pl
            if not 0 <= n < len(doc):
                return None
            return doc[n].render(scale=scale).to_pil().convert("RGB")
        finally:
            doc.close()


def all_page_images(data: bytes, scale: float, forms: bool = False) -> list[Image.Image]:
    import pypdfium2 as pdfium

    with LOCK:
        doc = pdfium.PdfDocument(data)
        try:
            if forms:
                doc.init_forms()
            return [doc[i].render(scale=scale).to_pil().convert("RGB") for i in range(len(doc))]
        finally:
            doc.close()


def png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
