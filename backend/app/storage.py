"""Szyfrowane przechowywanie plików na dysku (dokumenty, podpisy, skany, badania, zdjęcia).

Format pliku: b"APTF" + wersja (1 bajt) + nonce (12 bajtów) + szyfrogram AES-256-GCM z tagiem.
Klucz jest wyprowadzany z APT_DATA_KEY (HKDF, osobny kontekst niż dla PESEL).
Odczyt pliku bez nagłówka zwraca go bez zmian – stare, jeszcze jawne pliki działają, dopóki nie przejdzie
`encrypt-files` (uruchamiane przy każdym starcie aplikacji).
Zapis jest atomowy (plik tymczasowy + rename), więc przerwanie nie zostawia uciętego pliku.
Nie szyfrujemy szablonów .docx (bez danych osobowych) ani pliku listy zaufania.
"""

import os
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app import crypto
from app.config import get_settings

MAGIC = b"APTF\x01"
_AAD = b"apt/file/v1"
# katalogi z danymi osobowymi w APT_DATA_DIR
ENCRYPTED_DIRS = ("photos", "documents", "trainings", "medical")


class FileDecryptError(RuntimeError):
    pass


@lru_cache
def _key() -> bytes:
    return HKDF(algorithm=SHA256(), length=32, salt=None, info=b"apt/files/enc/v1").derive(
        crypto._master_key()
    )


def is_encrypted_bytes(data: bytes) -> bool:
    return data[: len(MAGIC)] == MAGIC


def encrypt_bytes(data: bytes) -> bytes:
    nonce = os.urandom(12)
    return MAGIC + nonce + AESGCM(_key()).encrypt(nonce, data, _AAD)


def decrypt_bytes(blob: bytes) -> bytes:
    if not is_encrypted_bytes(blob):
        return blob  # plik sprzed szyfrowania
    nonce, ct = blob[len(MAGIC) : len(MAGIC) + 12], blob[len(MAGIC) + 12 :]
    try:
        return AESGCM(_key()).decrypt(nonce, ct, _AAD)
    except InvalidTag as exc:
        raise FileDecryptError(
            "Nie można odszyfrować pliku (zły klucz APT_DATA_KEY albo plik uszkodzony)."
        ) from exc


def write(path: Path, data: bytes) -> None:
    """Zapisuje plik zaszyfrowany (atomowo)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_bytes(encrypt_bytes(data))
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def read(path: Path) -> bytes:
    """Czyta plik i zwraca jego treść jawną (odszyfrowaną)."""
    return decrypt_bytes(path.read_bytes())


@dataclass
class EncryptReport:
    encrypted: int = 0
    already: int = 0
    failed: int = 0


def encrypt_tree(root: Path | None = None) -> EncryptReport:
    """Szyfruje w miejscu jawne pliki z danymi osobowymi. Można uruchamiać wielokrotnie."""
    base = root or Path(get_settings().data_dir)
    rep = EncryptReport()
    for sub in ENCRYPTED_DIRS:
        d = base / sub
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*")):
            if not p.is_file() or p.name.startswith(".") or p.suffix == ".tmp":
                continue
            try:
                with p.open("rb") as fh:
                    head = fh.read(len(MAGIC))
                if is_encrypted_bytes(head):
                    rep.already += 1
                    continue
                write(p, p.read_bytes())
                rep.encrypted += 1
            except OSError:
                rep.failed += 1
    return rep
