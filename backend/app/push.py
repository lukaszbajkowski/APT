"""Powiadomienia push (Web Push, VAPID). Treść jest zawsze ogólna – bez danych osobowych.

Klucze serwera generują się przy pierwszym użyciu i leżą w katalogu danych (`vapid.json`, klucz prywatny
zaszyfrowany kluczem aplikacji), więc wchodzą do kopii zapasowej i nie wymagają ręcznej konfiguracji.
"""

import base64
import json
import logging
import threading
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crypto
from app.config import get_settings
from app.db import SessionLocal
from app.models import PushSubscription

log = logging.getLogger("apt.push")

# Testy podmieniają tę listę, żeby zbierać wysyłane powiadomienia (user_id, tytuł, treść, adres).
outbox: list[tuple[int, str, str, str]] | None = None
_lock = threading.Lock()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _keys() -> tuple[str, str]:
    """(prywatny PEM, publiczny klucz b64url dla przeglądarki); generowane przy pierwszym użyciu."""
    path = Path(get_settings().data_dir) / "vapid.json"
    with _lock:
        try:
            raw = json.loads(path.read_text())
            pem = crypto.decrypt_secret(base64.b64decode(raw["private"])).decode()
            return pem, raw["public"]
        except (OSError, ValueError, KeyError):
            pass
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        public = _b64(
            key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"private": base64.b64encode(crypto.encrypt_secret(pem.encode())).decode(), "public": public}
            )
        )
        path.chmod(0o600)
        return pem, public


def public_key() -> str:
    return _keys()[1]


def _url_for(url: str, user_id: int) -> str:
    """Adres po kliknięciu: z numerem konta adresata, żeby aplikacja przełączyła się na właściwe konto."""
    return url + ("&" if "?" in url else "?") + f"u={user_id}"


def notify_users(db: Session, user_ids: list[int], title: str, body: str, url: str = "/") -> int:
    """Wysyła powiadomienie na wszystkie urządzenia podanych kont (w tle). Zwraca liczbę urządzeń."""
    if not user_ids:
        return 0
    subs = list(db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(user_ids))))
    if outbox is not None:
        for s in subs:
            outbox.append((s.user_id, title, body, _url_for(url, s.user_id)))
        return len(subs)
    if not subs:
        return 0
    jobs = [
        (s.id, {"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}, s.user_id)
        for s in subs
    ]
    threading.Thread(target=_deliver, args=(jobs, title, body, url), daemon=True).start()
    return len(jobs)


def _deliver(jobs: list[tuple[int, dict, int]], title: str, body: str, url: str) -> None:
    from datetime import UTC, datetime

    from pywebpush import WebPushException, webpush

    s = get_settings()
    try:
        pem, _ = _keys()
    except Exception:  # noqa: BLE001
        log.exception("Klucze push niedostępne")
        return
    contact = s.mail_from.split("<")[-1].strip(" >") if s.mail_from else ""
    claims = {"sub": f"mailto:{contact}" if "@" in contact else s.public_url}
    for sub_id, info, user_id in jobs:
        payload = json.dumps({"title": title, "body": body, "url": _url_for(url, user_id)})
        try:
            webpush(
                subscription_info=info,
                data=payload,
                vapid_private_key=pem,
                vapid_claims=dict(claims),
                ttl=24 * 3600,
                timeout=10,
            )
            with SessionLocal() as db:
                row = db.get(PushSubscription, sub_id)
                if row is not None:
                    row.last_ok_at = datetime.now(UTC)
                    db.commit()
        except WebPushException as exc:
            code = getattr(exc.response, "status_code", None)
            if code in (404, 410):  # subskrypcja wygasła albo odwołana w przeglądarce
                with SessionLocal() as db:
                    row = db.get(PushSubscription, sub_id)
                    if row is not None:
                        db.delete(row)
                        db.commit()
            else:
                log.warning("Push nieudany (%s): %s", code, exc)
        except Exception:  # noqa: BLE001
            log.exception("Push nieudany")
