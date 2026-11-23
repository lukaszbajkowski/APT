"""Zbieranie błędów aplikacji: nieobsłużone błędy API (5xx) i błędy zgłoszone przez przeglądarkę.

Bez danych osobowych: adres to szablon trasy („/api/employees/{employee_id}”), bez parametrów zapytania;
z komunikatu wycinane są ciągi cyfr (PESEL, telefony, numery), adresy e-mail i parametry z adresów.
Te same błędy grupują się w jeden wpis (licznik, pierwsze i ostatnie wystąpienie); wpisy starsze niż 30
dni znikają.
"""

import hashlib
import logging
import re
import threading
import time
from datetime import timedelta

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.deps import utcnow
from app.models import AppError

log = logging.getLogger("apt.errors")

_DIGITS = re.compile(r"\d{4,}")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
_QUERY = re.compile(r"\?[^\s\"'<>)]*")
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
KEEP_DAYS = 30


def scrub(text: str | None, limit: int) -> str:
    """Usuwa z tekstu to, co mogłoby być daną osobową albo kluczem w adresie."""
    t = (text or "").strip()
    t = _QUERY.sub("?…", t)
    t = _EMAIL.sub("…@…", t)
    t = _UUID.sub("…", t)
    t = _DIGITS.sub("…", t)
    return t[:limit]


def record(
    source: str, kind: str, message: str, path: str, status: int | None = None, role: str | None = None
) -> None:
    """Zapisuje błąd (albo zwiększa licznik istniejącego). Nigdy nie rzuca – zbieranie błędów nie może
    ich mnożyć."""
    kind_s = scrub(kind, 120) or "Błąd"
    msg_s = scrub(message, 500)
    path_s = scrub(path, 200)
    fp = hashlib.sha256(f"{source}|{kind_s}|{msg_s[:200]}|{path_s}|{status}".encode()).hexdigest()[:32]
    try:
        with SessionLocal() as db:
            now = utcnow()
            row = db.scalar(select(AppError).where(AppError.fingerprint == fp))
            if row:
                row.count += 1
                row.last_at = now
                if role:
                    row.role = role
            else:
                db.add(
                    AppError(
                        fingerprint=fp,
                        source=source,
                        kind=kind_s,
                        message=msg_s,
                        path=path_s,
                        status=status,
                        role=role,
                        first_at=now,
                        last_at=now,
                    )
                )
                db.execute(delete(AppError).where(AppError.last_at < now - timedelta(days=KEEP_DAYS)))
            db.commit()
    except Exception:  # noqa: BLE001
        log.exception("Nie udało się zapisać błędu aplikacji")


# zgłoszenia z przeglądarki: najwyżej 30 na minutę na konto (pętla błędów nie zaleje bazy)
_rate: dict[int, list[float]] = {}
_lock = threading.Lock()


def browser_allowed(user_id: int, per_min: int = 30) -> bool:
    now = time.monotonic()
    with _lock:
        hits = [t for t in _rate.get(user_id, []) if now - t < 60]
        if len(hits) >= per_min:
            _rate[user_id] = hits
            return False
        hits.append(now)
        _rate[user_id] = hits
        return True
