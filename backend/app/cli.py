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


def send_test_mail(to: str) -> int:
    from app import mailer

    if not mailer.enabled():
        print("Wysyłka wyłączona: ustaw APT_SMTP_HOST i APT_MAIL_FROM.", file=sys.stderr)
        return 1
    try:
        mailer.send_now(
            to, "Test – Identyfikacja pracowników APT", "To jest wiadomość testowa. E-maile działają."
        )
    except Exception as e:  # noqa: BLE001
        print(f"Błąd wysyłki: {e}", file=sys.stderr)
        return 1
    print(f"Wysłano wiadomość testową do {to}.")
    return 0


def notify_daily() -> int:
    """Codzienne ostrzeżenia dla administratorów (wywoływane przez deploy/backup.sh)."""
    from datetime import UTC, datetime, timedelta

    from app import mailer, notify
    from app.routers.dashboard import read_backup_status
    from app.routers.retention import count_due

    problems: list[str] = []
    status = read_backup_status()
    now = datetime.now(UTC)
    if status is None or status.local is None:
        problems.append("Brak informacji o kopiach zapasowych.")
    else:
        if not status.local.ok:
            problems.append(f"Kopia zapasowa nie powiodła się: {status.local.info}")
        elif now - status.local.at > timedelta(hours=36):
            problems.append(f"Ostatnia kopia zapasowa jest z {status.local.at:%d.%m.%Y %H:%M}.")
        if status.offsite is not None and not status.offsite.ok:
            problems.append(f"Wysyłka kopii poza serwer nie powiodła się: {status.offsite.info[:300]}")
    with SessionLocal() as db:
        due = count_due(db)
        if due:
            problems.append(
                f"Dane {due} os. mają za sobą okres przechowywania – usuń je w zakładce Retencja danych."
            )
        admins = notify.admins_with_email(db)
    if not problems:
        print("Brak problemów – nie wysyłam.")
        return 0
    text = "Wymaga uwagi:\n\n" + "\n".join(f"• {p}" for p in problems) + f"\n\n{mailer.link('/')}"
    if mailer.enabled():
        for a in admins:
            try:
                mailer.send_now(a.email, "Identyfikacja APT – wymaga uwagi", text)
            except Exception as e:  # noqa: BLE001
                print(f"Błąd wysyłki do {a.email}: {e}", file=sys.stderr)
    print(f"Problemy: {len(problems)}, powiadomieni administratorzy: {len(admins)}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="Utwórz konto administratora")
    p.add_argument("--username", required=True)
    p.add_argument("--full-name", required=True)
    p = sub.add_parser("reset-mfa", help="Wyłącz logowanie dwuetapowe użytkownika")
    p.add_argument("--username", required=True)
    p = sub.add_parser("send-test-mail", help="Wyślij e-mail testowy")
    p.add_argument("--to", required=True)
    sub.add_parser("notify-daily", help="Ostrzeżenia dla administratorów (kopie, retencja)")
    sub.add_parser("generate-key", help="Wygeneruj klucz APT_DATA_KEY do szyfrowania PESEL")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        return create_admin(args.username, args.full_name)
    if args.command == "reset-mfa":
        return reset_mfa(args.username)
    if args.command == "send-test-mail":
        return send_test_mail(args.to)
    if args.command == "notify-daily":
        return notify_daily()
    if args.command == "generate-key":
        from app.crypto import generate_key

        print(generate_key())
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
