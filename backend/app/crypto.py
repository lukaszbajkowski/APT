"""Szyfrowanie PESEL.

- Szyfrowanie: AES-256-GCM, losowy nonce. Format: b"\\x01" + nonce(12) + szyfrogram+tag.
- Skrót do wykrywania duplikatów: HMAC-SHA256 (deterministyczny, bez możliwości odwrócenia).
Oba klucze wyprowadzane z APT_DATA_KEY przez HKDF z różnym kontekstem.
"""

import base64
import hashlib
import hmac
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings

_VERSION = b"\x01"


class DataKeyMissing(RuntimeError):
    pass


def generate_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")


def _master_key() -> bytes:
    raw = get_settings().data_key.strip()
    if not raw:
        raise DataKeyMissing("Brak klucza APT_DATA_KEY. Wygeneruj go: python -m app.cli generate-key")
    key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    if len(key) != 32:
        raise DataKeyMissing("APT_DATA_KEY musi mieć 32 bajty (base64url).")
    return key


def _derive(info: bytes) -> bytes:
    return HKDF(algorithm=SHA256(), length=32, salt=None, info=info).derive(_master_key())


@lru_cache
def _keys() -> tuple[bytes, bytes]:
    return _derive(b"apt/pesel/enc/v1"), _derive(b"apt/pesel/hmac/v1")


def encrypt(plaintext: str) -> bytes:
    enc_key, _ = _keys()
    nonce = os.urandom(12)
    return _VERSION + nonce + AESGCM(enc_key).encrypt(nonce, plaintext.encode(), b"pesel")


def decrypt(blob: bytes) -> str:
    enc_key, _ = _keys()
    if not blob or blob[:1] != _VERSION:
        raise ValueError("Nieznany format zaszyfrowanych danych.")
    nonce, ct = blob[1:13], blob[13:]
    return AESGCM(enc_key).decrypt(nonce, ct, b"pesel").decode()


@lru_cache
def _totp_key() -> bytes:
    return _derive(b"apt/totp/enc/v1")


def encrypt_secret(secret: bytes) -> bytes:
    """Szyfrowanie sekretu TOTP (osobny klucz wyprowadzony z APT_DATA_KEY)."""
    nonce = os.urandom(12)
    return _VERSION + nonce + AESGCM(_totp_key()).encrypt(nonce, secret, b"totp")


def decrypt_secret(blob: bytes) -> bytes:
    if not blob or blob[:1] != _VERSION:
        raise ValueError("Nieznany format zaszyfrowanych danych.")
    return AESGCM(_totp_key()).decrypt(blob[1:13], blob[13:], b"totp")


@lru_cache
def _contact_key() -> bytes:
    return _derive(b"apt/contact/enc/v1")


def encrypt_contact(value: str) -> bytes:
    """Telefon / e-mail pracownika: szyfrowanie osobnym kluczem wyprowadzonym z APT_DATA_KEY."""
    nonce = os.urandom(12)
    return _VERSION + nonce + AESGCM(_contact_key()).encrypt(nonce, value.encode(), b"contact")


def decrypt_contact(blob: bytes) -> str:
    if not blob or blob[:1] != _VERSION:
        raise ValueError("Nieznany format zaszyfrowanych danych.")
    return AESGCM(_contact_key()).decrypt(blob[1:13], blob[13:], b"contact").decode()


def blind_index(value: str) -> str:
    _, mac_key = _keys()
    return hmac.new(mac_key, value.encode(), hashlib.sha256).hexdigest()


def reset_cache() -> None:
    _keys.cache_clear()
    _totp_key.cache_clear()
    _contact_key.cache_clear()
