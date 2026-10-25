"""Kody jednorazowe TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 cyfr) i kody zapasowe."""

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from typing import TYPE_CHECKING
from urllib.parse import quote, urlencode

if TYPE_CHECKING:
    from app.models import User

STEP = 30
DIGITS = 6
WINDOW = 1  # akceptujemy kod z poprzedniego i następnego okna (różnice zegarów)
ISSUER = "Identyfikacja APT"


def new_secret() -> bytes:
    return os.urandom(20)


def secret_b32(secret: bytes) -> str:
    return base64.b32encode(secret).decode().rstrip("=")


def secret_display(secret: bytes) -> str:
    """Sekret w grupach po 4 znaki – do ręcznego wpisania w aplikacji."""
    s = secret_b32(secret)
    return " ".join(s[i : i + 4] for i in range(0, len(s), 4))


def provisioning_uri(secret: bytes, username: str) -> str:
    label = quote(f"{ISSUER}:{username}")
    params = urlencode({"secret": secret_b32(secret), "issuer": ISSUER, "digits": DIGITS, "period": STEP})
    return f"otpauth://totp/{label}?{params}"


def code_at(secret: bytes, step: int) -> str:
    digest = hmac.new(secret, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP)


def normalize(code: str) -> str:
    return "".join(ch for ch in code if not ch.isspace() and ch != "-").upper()


def verify(secret: bytes, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """Zwraca numer okna czasowego, jeśli kod jest poprawny i nie był już użyty; inaczej None."""
    code = normalize(code)
    if len(code) != DIGITS or not code.isdigit():
        return None
    step = current_step(now)
    for candidate in range(step - WINDOW, step + WINDOW + 1):
        if last_step is not None and candidate <= last_step:
            continue  # ochrona przed ponownym użyciem tego samego kodu
        if hmac.compare_digest(code_at(secret, candidate), code):
            return candidate
    return None


# --- kody zapasowe ---------------------------------------------------------

_RC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_COUNT = 10


def new_recovery_codes() -> list[str]:
    def one() -> str:
        raw = "".join(secrets.choice(_RC_ALPHABET) for _ in range(10))
        return f"{raw[:5]}-{raw[5:]}"

    return [one() for _ in range(RECOVERY_COUNT)]


def hash_recovery(code: str) -> str:
    return hashlib.sha256(normalize(code).encode()).hexdigest()


def use_recovery(hashes: list[str], code: str) -> list[str] | None:
    """Jeśli kod pasuje, zwraca listę bez niego (kod jednorazowy); inaczej None."""
    h = hash_recovery(code)
    for stored in hashes:
        if hmac.compare_digest(stored, h):
            return [x for x in hashes if x != stored]
    return None


# --- kod QR (SVG) ------------------------------------------------------------


def qr_svg(data: str, border: int = 2) -> str:
    """Kompaktowy SVG kodu QR (jedna ścieżka, czarne moduły na białym tle)."""
    from reportlab.graphics.barcode import qrencoder

    qr = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)
    qr.addData(data)
    qr.make()
    n = qr.getModuleCount()
    size = n + 2 * border
    path = "".join(
        f"M{c + border} {r + border}h1v1h-1z" for r in range(n) for c in range(n) if qr.isDark(r, c)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">'
        f'<rect width="{size}" height="{size}" fill="#fff"/><path d="{path}" fill="#000"/></svg>'
    )


def clear(user: "User") -> None:
    """Wyłącza logowanie dwuetapowe użytkownika (sekret i kody zapasowe)."""
    user.totp_secret_enc = None
    user.totp_enabled_at = None
    user.totp_last_step = None
    user.recovery_codes = []
