"""Polecenia administracyjne.

Pierwszy administrator:
    docker compose exec api python -m app.cli create-admin --username admin --full-name "Jan Kowalski"

Reset logowania dwuetapowego (np. administrator zgubił telefon):
    docker compose exec api python -m app.cli reset-mfa --username admin

Klucz do szyfrowania PESEL (APT_DATA_KEY w pliku .env):
    python -m app.cli generate-key
"""

import argparse
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, Role, User
from app.security import generate_temporary_password, hash_password


def create_admin(username: str, full_name: str) -> int:
    username = username.strip().lower()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == username)):
            print(f"Użytkownik '{username}' już istnieje.", file=sys.stderr)
            return 1
        password = generate_temporary_password()
        user = User(
            username=username,
            full_name=full_name,
            role=Role.admin,
            password_hash=hash_password(password),
            is_active=True,
            must_change_password=True,
            failed_login_count=0,
        )
        db.add(user)
        db.flush()
        db.add(
            AuditLog(
                username="(cli)",
                action="user_created",
                entity_type="user",
                entity_id=str(user.id),
                details={"username": username, "role": "admin", "source": "cli"},
            )
        )
        db.commit()
    print(f"Utworzono administratora '{username}'.")
    print(f"Hasło tymczasowe (zmiana wymagana przy pierwszym logowaniu): {password}")
    return 0


def reset_mfa(username: str) -> int:
    from sqlalchemy import update

    from app import totp
    from app.deps import utcnow
    from app.models import UserSession

    username = username.strip().lower()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            print(f"Nie ma użytkownika '{username}'.", file=sys.stderr)
            return 1
        totp.clear(user)
        user.failed_login_count = 0
        user.locked_until = None
        db.execute(
            update(UserSession)
            .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        db.add(
            AuditLog(
                username="(cli)",
                action="mfa_reset",
                entity_type="user",
                entity_id=str(user.id),
                details={"username": username, "source": "cli"},
            )
        )
        db.commit()
    print(f"Wyłączono logowanie dwuetapowe dla '{username}'. Przy logowaniu skonfiguruje je ponownie.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="Utwórz konto administratora")
    p.add_argument("--username", required=True)
    p.add_argument("--full-name", required=True)
    p = sub.add_parser("reset-mfa", help="Wyłącz logowanie dwuetapowe użytkownika")
    p.add_argument("--username", required=True)
    sub.add_parser("generate-key", help="Wygeneruj klucz APT_DATA_KEY do szyfrowania PESEL")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        return create_admin(args.username, args.full_name)
    if args.command == "reset-mfa":
        return reset_mfa(args.username)
    if args.command == "generate-key":
        from app.crypto import generate_key

        print(generate_key())
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
