"""Wysyłka e-maili przez SMTP (np. konto pocztowe w hostingu home.pl)."""

import logging
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr

from app.config import get_settings

log = logging.getLogger("apt.mail")

FOOTER = "\n\n—\nIdentyfikacja pracowników APT\nWiadomość wysłana automatycznie, nie odpowiadaj na nią."


def enabled() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.mail_from)


def link(path: str) -> str:
    return get_settings().public_url.rstrip("/") + path


def _build(to: str, subject: str, text: str) -> EmailMessage:
    s = get_settings()
    msg = EmailMessage()
    name, addr = parseaddr(s.mail_from)
    msg["From"] = formataddr((name or "Identyfikacja APT", addr))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=addr.split("@")[-1] if "@" in addr else None)
    msg.set_content(text + FOOTER)
    return msg


def send_now(to: str, subject: str, text: str) -> None:
    """Wysyła od razu; wyjątki przekazuje dalej (do testów i polecenia CLI)."""
    s = get_settings()
    msg = _build(to, subject, text)
    ctx = ssl.create_default_context()
    if s.smtp_security == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ctx, timeout=20)
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20)
    with server:
        if s.smtp_security == "starttls":
            server.starttls(context=ctx)
        if s.smtp_user:
            server.login(s.smtp_user, s.smtp_password)
        server.send_message(msg)


# Testy podmieniają tę listę, żeby zbierać wysłane wiadomości.
outbox: list[tuple[str, str, str]] | None = None


def send(to: str | None, subject: str, text: str) -> bool:
    """Wysyła w tle (nie blokuje odpowiedzi). False, gdy brak adresu lub wysyłka wyłączona."""
    if not to:
        return False
    if outbox is not None:
        outbox.append((to, subject, text))
        return True
    if not enabled():
        log.info("E-mail wyłączony (brak APT_SMTP_HOST) – pomijam: %s", subject)
        return False

    def worker() -> None:
        try:
            send_now(to, subject, text)
        except Exception:  # noqa: BLE001
            log.exception("Nie udało się wysłać e-maila: %s", subject)

    threading.Thread(target=worker, daemon=True).start()
    return True
