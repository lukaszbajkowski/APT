"""Zabezpieczenia publicznych adresów podpisu: maskowanie tokenów w logach i ograniczenie liczby żądań."""

import logging
import re
import threading
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import get_settings

_TOKEN_IN_PATH = re.compile(r"(/api/(?:sign|data-link)/)[^/?\s\"]+")
_TOKEN_IN_QUERY = re.compile(r"([?&](?:token|v|view|k)=)[^&\s\"]+")


def mask_tokens(text: str) -> str:
    """Zastępuje token linku do podpisu i klucz podglądu gwiazdkami (do logów)."""
    return _TOKEN_IN_QUERY.sub(r"\1***", _TOKEN_IN_PATH.sub(r"\1***", text))


class MaskTokensFilter(logging.Filter):
    """Filtr dziennika dostępu serwera – tokeny nie mogą trafić do logów w postaci jawnej."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(mask_tokens(a) if isinstance(a, str) else a for a in record.args)
        if isinstance(record.msg, str):
            record.msg = mask_tokens(record.msg)
        return True


def install_log_filter() -> None:
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        lg = logging.getLogger(name)
        if not any(isinstance(f, MaskTokensFilter) for f in lg.filters):
            lg.addFilter(MaskTokensFilter())


class RateLimiter:
    """Okno przesuwane w pamięci: najwyżej `limit` żądań na klucz w `window` sekund."""

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def allow(self, key: tuple[str, str], limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            self._calls += 1
            if self._calls % 2000 == 0:  # sprzątanie nieużywanych kluczy
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < window}
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


async def sign_rate_limit(request: Request, call_next):  # noqa: ANN001, ANN201
    """Publiczne adresy /api/sign/* – limit żądań na adres IP (osobno odczyt i zapis)."""
    if request.url.path.startswith(("/api/sign/", "/api/data-link/")):
        s = get_settings()
        kind = "post" if request.method == "POST" else "get"
        limit = s.sign_rate_post if kind == "post" else s.sign_rate_get
        ip = request.client.host if request.client else "?"
        if limit > 0 and not limiter.allow((ip, kind), limit):
            return JSONResponse(
                {"detail": "Zbyt wiele żądań. Spróbuj ponownie za minutę."},
                status_code=429,
                headers={"Retry-After": "60"},
            )
    return await call_next(request)
