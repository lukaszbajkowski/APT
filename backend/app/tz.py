"""Strefy czasowe użytkowników.

Firma działa w czasie polskim (Europe/Warsaw) – w nim liczą się terminy, dziennik zdarzeń, znak wodny
i podpisy dokumentów. Pracownik albo członek kadr może jednak mieszkać lub pracować w innej strefie:
aplikacja wykrywa ją z urządzenia i zapisuje na koncie (`User.timezone`), a e-maile i powiadomienia podają
wtedy godzinę u odbiorcy razem z czasem polskim.
"""

from datetime import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo, available_timezones

HOME = "Europe/Warsaw"
HOME_TZ = ZoneInfo(HOME)


@lru_cache(maxsize=1)
def _known() -> frozenset[str]:
    return frozenset(available_timezones())


def valid(name: str | None) -> bool:
    return bool(name) and name in _known()


def zone(name: str | None) -> ZoneInfo:
    return ZoneInfo(name) if valid(name) else HOME_TZ


def city(name: str) -> str:
    """„Europe/Kyiv” → „Kyiv”, „America/New_York” → „New York”."""
    return name.rsplit("/", 1)[-1].replace("_", " ")


def when(dt: datetime, tz_name: str | None = None, *, short: bool = False) -> str:
    """Data i godzina dla odbiorcy. Poza Polską: godzina u odbiorcy (miasto strefy) i w nawiasie czas polski."""
    fmt = "%d.%m %H:%M" if short else "%d.%m.%Y, %H:%M"
    home = dt.astimezone(HOME_TZ)
    if not valid(tz_name) or tz_name == HOME:
        return home.strftime(fmt)
    local = dt.astimezone(ZoneInfo(tz_name))  # type: ignore[arg-type]
    if local.utcoffset() == home.utcoffset():
        return home.strftime(fmt)
    return f"{local.strftime(fmt)} ({city(tz_name)}; {home.strftime('%H:%M')} czasu polskiego)"  # type: ignore[arg-type]
