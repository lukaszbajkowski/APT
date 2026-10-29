"""Tłumaczenie wiadomości przez Google Cloud Translation (Basic, v2) – na żądanie, bez zapisu w bazie.

Klucz API wpisuje administrator w pliku .env na serwerze (APT_GOOGLE_TRANSLATE_KEY). Bez klucza funkcja jest
wyłączona i nic nie opuszcza serwera. Do Google trafia tylko treść jednej wiadomości, po kliknięciu.
"""

import json
import logging
import time
import urllib.request
from datetime import UTC, datetime

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AuditLog

log = logging.getLogger("apt.translate")

API = "https://translation.googleapis.com/language/translate/v2"
LANGS_TTL = 24 * 3600
_langs: dict[str, tuple[float, list[dict[str, str]]]] | None = None  # nazwy języków per język wyświetlania

# W testach podmieniane na funkcję zwracającą gotowe odpowiedzi (bez sieci).
transport = None


class TranslateError(Exception):
    pass


def enabled() -> bool:
    return bool(get_settings().google_translate_key.strip())


def _call(path: str, payload: dict) -> dict:
    if transport is not None:
        return transport(path, payload)
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "X-Goog-Api-Key": get_settings().google_translate_key.strip(),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 – stały adres https
            return json.loads(r.read().decode() or "{}")
    except Exception as exc:  # noqa: BLE001
        raise TranslateError("Usługa tłumaczenia jest chwilowo niedostępna.") from exc


def _upper_first(name: str) -> str:
    return name[:1].upper() + name[1:]


def languages(display: str = "pl") -> list[dict[str, str]]:
    """Języki usługi z nazwami w języku `display` (od wielkiej litery); pamięć podręczna na dobę."""
    global _langs
    if _langs is None:
        _langs = {}
    hit = _langs.get(display)
    if hit and time.monotonic() - hit[0] < LANGS_TTL:
        return hit[1]
    data = _call("/languages", {"target": display})
    items = [
        {"code": x["language"], "name": _upper_first(x.get("name") or x["language"])}
        for x in data.get("data", {}).get("languages", [])
        if x.get("language")
    ]
    items.sort(key=lambda x: x["name"].casefold())
    _langs[display] = (time.monotonic(), items)
    return items


def translate(text: str, target: str) -> tuple[str, str | None]:
    """Zwraca (tłumaczenie, wykryty język źródłowy). Treść nie jest nigdzie zapisywana ani logowana."""
    data = _call("", {"q": text, "target": target, "format": "text"})
    try:
        t = data["data"]["translations"][0]
        return t["translatedText"], t.get("detectedSourceLanguage")
    except (KeyError, IndexError, TypeError) as exc:
        raise TranslateError("Usługa tłumaczenia zwróciła nieoczekiwaną odpowiedź.") from exc


# Działania w dzienniku, których znaki liczą się do wspólnego miesięcznego limitu.
COUNTED_ACTIONS = ("message_translated", "ui_translated")


def used_this_month(db: Session) -> int:
    """Znaki wysłane do tłumacza od początku miesiąca (z dziennika; treści tam nie ma)."""
    start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    n = db.scalar(
        select(func.coalesce(func.sum(cast(AuditLog.details["chars"].astext, Integer)), 0)).where(
            AuditLog.action.in_(COUNTED_ACTIONS), AuditLog.ts >= start
        )
    )
    return int(n or 0)


def exhausted(db: Session, extra: int = 0) -> bool:
    """Czy limit jest wyczerpany (z `extra`: czy nie zmieści się jeszcze tekst o tej długości)."""
    limit = get_settings().translate_monthly_chars
    used = used_this_month(db)
    return limit > 0 and (used + extra > limit if extra else used >= limit)
