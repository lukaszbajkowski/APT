"""SMS przez SMSAPI.pl – działa, gdy ustawiono APT_SMSAPI_TOKEN."""

import json
import logging
import re
import urllib.parse
import urllib.request

from app.config import get_settings

log = logging.getLogger("apt.sms")

# Testy podmieniają tę listę, żeby zbierać wysłane wiadomości.
outbox: list[tuple[str, str]] | None = None


class SmsError(RuntimeError):
    pass


def enabled() -> bool:
    return outbox is not None or bool(get_settings().smsapi_token)


def normalize_phone(raw: str) -> str:
    """Polski numer komórkowy → 48XXXXXXXXX; inne z prefiksem + zostawiamy (bez +)."""
    digits = re.sub(r"[^\d+]", "", raw or "")
    if digits.startswith("+"):
        digits = digits[1:]
    elif digits.startswith("00"):
        digits = digits[2:]
    elif len(digits) == 9:
        digits = "48" + digits
    if not re.fullmatch(r"\d{10,15}", digits):
        raise SmsError("Nieprawidłowy numer telefonu.")
    return digits


def send(phone: str, text: str) -> None:
    to = normalize_phone(phone)
    if outbox is not None:
        outbox.append((to, text))
        return
    s = get_settings()
    if not s.smsapi_token:
        raise SmsError("Wysyłka SMS nie jest skonfigurowana (brak APT_SMSAPI_TOKEN).")
    data = {"to": to, "message": text, "format": "json", "encoding": "utf-8"}
    if s.sms_sender:
        data["from"] = s.sms_sender
    req = urllib.request.Request(
        "https://api.smsapi.pl/sms.do",
        data=urllib.parse.urlencode(data).encode(),
        headers={"Authorization": f"Bearer {s.smsapi_token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 – stały adres https
            body = json.loads(r.read().decode() or "{}")
    except Exception as exc:  # noqa: BLE001
        raise SmsError(f"Nie udało się wysłać SMS: {exc}") from exc
    if "error" in body:
        raise SmsError(f"SMSAPI: {body.get('message') or body['error']}")
    log.info("SMS wysłany do %s***", to[:5])
