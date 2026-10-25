"""Treści e-maili i jednorazowe linki do ustawienia hasła."""

from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import mailer
from app.models import PasswordToken, Role, User
from app.security import new_token, token_hash

RESET_MINUTES = 60
INVITE_HOURS = 72


def create_token(db: Session, user: User, purpose: str, now: datetime) -> str:
    """Nowy link; poprzednie niewykorzystane linki tego użytkownika przestają działać."""
    db.execute(
        update(PasswordToken)
        .where(PasswordToken.user_id == user.id, PasswordToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = new_token()
    ttl = timedelta(minutes=RESET_MINUTES) if purpose == "reset" else timedelta(hours=INVITE_HOURS)
    db.add(
        PasswordToken(user_id=user.id, token_hash=token_hash(token), purpose=purpose, expires_at=now + ttl)
    )
    return token


def find_token(db: Session, token: str, now: datetime) -> PasswordToken | None:
    t = db.scalar(select(PasswordToken).where(PasswordToken.token_hash == token_hash(token)))
    if t is None or t.used_at is not None or t.expires_at <= now or not t.user.is_active:
        return None
    return t


def send_reset(user: User, token: str) -> None:
    mailer.send(
        user.email,
        "Reset hasła – Identyfikacja pracowników APT",
        f"Dzień dobry {user.full_name},\n\n"
        f"ktoś (prawdopodobnie Ty) poprosił o reset hasła do konta „{user.username}”.\n"
        f"Aby ustawić nowe hasło, otwórz link (ważny {RESET_MINUTES} minut):\n\n"
        f"{mailer.link('/ustaw-haslo?token=' + token)}\n\n"
        "Jeśli to nie Ty – zignoruj tę wiadomość, hasło się nie zmieni.",
    )


def send_invite(user: User, token: str) -> None:
    mailer.send(
        user.email,
        "Konto w aplikacji Identyfikacja pracowników APT",
        f"Dzień dobry {user.full_name},\n\n"
        f"założono dla Ciebie konto „{user.username}” w aplikacji Identyfikacja pracowników APT.\n"
        f"Ustaw swoje hasło (link ważny {INVITE_HOURS} godziny):\n\n"
        f"{mailer.link('/ustaw-haslo?token=' + token)}\n\n"
        f"Logowanie: {mailer.link('/login')}",
    )


def security_notice(user: User, what: str) -> None:
    """Informacja dla właściciela konta o ważnej zmianie (np. hasło, blokada, 2FA)."""
    mailer.send(
        user.email,
        f"Bezpieczeństwo konta: {what}",
        f"Dzień dobry {user.full_name},\n\n"
        f"na Twoim koncie „{user.username}”: {what}.\n\n"
        "Jeśli to nie Ty – natychmiast skontaktuj się z administratorem aplikacji.",
    )


def admins_with_email(db: Session) -> list[User]:
    return list(
        db.scalars(select(User).where(User.role == Role.admin, User.is_active, User.email.is_not(None)))
    )
