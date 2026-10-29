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
    from app import mailer, notify

    if not mailer.enabled():
        print("Wysyłka wyłączona: ustaw APT_SMTP_HOST i APT_MAIL_FROM.", file=sys.stderr)
        return 1
    try:
        mailer.send_now(to, notify.test_email())
    except Exception as e:  # noqa: BLE001
        print(f"Błąd wysyłki: {e}", file=sys.stderr)
        return 1
    print(f"Wysłano wiadomość testową do {to}.")
    return 0


def agency_reports() -> int:
    """Zestawienia za poprzedni miesiąc dla agencji (każda APT raz na miesiąc)."""
    from app import agency_report
    from app.db import SessionLocal

    with SessionLocal() as db:
        n = agency_report.send_monthly(db)
    print(f"Zestawienia dla agencji: wysłane {n}.")
    return 0


def refresh_trustlist() -> int:
    """Pobiera unijną listę zaufania (kwalifikowani dostawcy podpisu) do weryfikacji podpisów."""
    from app import trustlist

    try:
        n = trustlist.refresh()
    except Exception as exc:  # noqa: BLE001
        print(f"Nie udało się pobrać listy zaufania: {exc}", file=sys.stderr)
        return 1
    print(f"Lista zaufania: {n} certyfikatów urzędów kwalifikowanych.")
    return 0


def close_stale_threads() -> int:
    """Zamyka rozmowy „Napisz do kadr”, w których pracownik nie odpowiada na odpowiedź kadr."""
    from app.db import SessionLocal
    from app.routers.hr_messages import ARCHIVE_DAYS, AUTO_CLOSE_DAYS, auto_archive, close_stale

    with SessionLocal() as db:
        n = close_stale(db)
        a = auto_archive(db)
    print(f"Rozmowy zamknięte automatycznie (brak odpowiedzi {AUTO_CLOSE_DAYS} dni): {n}.")
    print(f"Rozmowy zarchiwizowane automatycznie (zakończone ponad {ARCHIVE_DAYS} dni): {a}.")
    return 0


def stamp_pending() -> int:
    """Dodaje zaufane znaczniki czasu do podpisanych dokumentów, które ich jeszcze nie mają."""
    from app import timestamp

    if not timestamp.enabled():
        print("Znaczniki czasu wyłączone (APT_TSA_URL jest pusty).")
        return 0
    done, failed = timestamp.stamp_pending(limit=100)
    print(f"Znaczniki czasu: dodano {done}, nieudane {failed}.")
    return 0


def encrypt_files() -> int:
    """Szyfruje pliki z danymi osobowymi na dysku (dokumenty, podpisy, skany, badania, zdjęcia)."""
    from app import storage

    rep = storage.encrypt_tree()
    if rep.encrypted or rep.failed:
        print(f"Szyfrowanie plików: nowych {rep.encrypted}, wcześniej {rep.already}, błędów {rep.failed}.")
    return 0


STALE_DAYS = 90


def _remind(db, u, title: str, body: str, url: str, msg=None) -> bool:
    """Przypomnienie dla konta: push na jego urządzenia i/lub e-mail (każde niezależnie od drugiego)."""
    from app import mailer, push

    ok = False
    try:
        ok = "ok" in push.send_now(db, u.id, title, body, url)
    except Exception as exc:  # noqa: BLE001
        print(f"- {u.username}: błąd powiadomienia push: {exc}", file=sys.stderr)
    if msg is not None and u.email and mailer.enabled():
        try:
            mailer.send_now(u.email, msg)
            ok = True
        except Exception as exc:  # noqa: BLE001
            print(f"- {u.username}: błąd wysyłki do {u.email}: {exc}", file=sys.stderr)
    return ok


def quality_reminders() -> int:
    """Przypomnienia o brakach w danych: admin i HR (wszyscy pracownicy), kierownicy (swój zakres)."""
    from sqlalchemy import select

    from app import notify
    from app.models import Role, User
    from app.routers.quality import summary

    sent = 0
    with SessionLocal() as db:
        users = db.scalars(
            select(User)
            .where(User.role.in_([Role.admin, Role.hr, Role.manager]), User.is_active)
            .order_by(User.username)
        ).unique()
        for u in users:
            s = summary(db, u)
            if not s.rows:
                print(f"- {u.username}: brak braków w zakresie – nie wysyłam")
                continue
            msg = notify.quality_email(u, [(c.label, c.count) for c in s.checks], len(s.rows))
            if _remind(db, u, "Braki w danych", f"Osób do uzupełnienia: {len(s.rows)}", "/braki", msg):
                sent += 1
                print(f"- {u.username}: wysłano ({len(s.rows)} os.)")
    print(f"Przypomnienia o brakach wysłane: {sent}.")
    return 0


def training_reminders() -> int:
    """Przypomnienia: szkolenia stanowiskowe ponad standard i ważność kończąca się w 30 dni.

    Dostają admin, HR i kierownicy (swój zakres)."""
    from sqlalchemy import select

    from app import notify
    from app.models import Role, User
    from app.routers.trainings import expiring, in_progress

    sent = 0
    with SessionLocal() as db:
        users = db.scalars(
            select(User)
            .where(User.role.in_([Role.admin, Role.hr, Role.manager]), User.is_active)
            .order_by(User.username)
        ).unique()
        for u in users:
            rows = expiring(db, u)
            late = [r for r in in_progress(db, u) if r.status == "overdue"]
            if not rows and not late:
                print(f"- {u.username}: nic nie wymaga uwagi – nie wysyłam")
                continue
            items = [
                f"Ponad standard: {r.last_name} {r.first_name} – {r.name or r.type_name}: "
                f"dzień {r.days} z {r.standard_days} (od {r.start_date:%d.%m.%Y})"
                for r in late
            ] + [
                f"{r.last_name} {r.first_name} – {r.name or r.type_name}: "
                + ("wygasło " if r.status == "expired" else "ważne do ")
                + r.valid_until.strftime("%d.%m.%Y")
                for r in rows
            ]
            total = len(items)
            if total > 50:
                items = items[:50] + [f"… i {total - 50} więcej w aplikacji"]
            expired = sum(r.status == "expired" for r in rows)
            msg = notify.trainings_email(u, items, expired, len(late), len(rows))
            body = f"Ponad standard: {len(late)}, ważność szkoleń: {len(rows)}"
            if _remind(db, u, "Szkolenia wymagają uwagi", body, "/szkolenia", msg):
                sent += 1
                print(f"- {u.username}: wysłano ({len(late)} ponad standard, {len(rows)} ważność)")
    print(f"Przypomnienia o szkoleniach wysłane: {sent}.")
    return 0


def medical_reminders() -> int:
    """Cotygodniowe przypomnienie o badaniach lekarskich: nieważne i kończące się w 30 dni.

    Dostają admin, HR, kierownicy i agencje (każdy w swoim zakresie)."""
    from datetime import date, timedelta

    from sqlalchemy import select

    from app import notify
    from app.models import Employee, EmployeeStatus, MedicalExam, Role, User
    from app.routers.employees import apply_scope, format_number

    today = date.today()
    sent = 0
    with SessionLocal() as db:
        users = db.scalars(
            select(User)
            .where(User.role.in_([Role.admin, Role.hr, Role.manager, Role.agency]), User.is_active)
            .order_by(User.username)
        ).unique()
        for u in users:
            q = (
                select(MedicalExam, Employee)
                .join(Employee, Employee.id == MedicalExam.employee_id)
                .where(Employee.status == EmployeeStatus.active, MedicalExam.valid_until.is_not(None))
                .order_by(MedicalExam.exam_date.desc())
            )
            seen: set[int] = set()
            late: list[str] = []
            soon: list[tuple[date, str]] = []
            for x, e in db.execute(apply_scope(q, u)).unique().all():
                if e.id in seen:  # liczy się tylko najnowsze badanie
                    continue
                seen.add(e.id)
                who = f"{e.last_name} {e.first_name} (nr {format_number(e.number)})"
                if x.valid_until < today:
                    late.append(f"{who}: nieważne od {x.valid_until:%d.%m.%Y}")
                elif x.valid_until <= today + timedelta(days=30):
                    soon.append((x.valid_until, f"{who}: ważne do {x.valid_until:%d.%m.%Y}"))
            if not late and not soon:
                continue
            items = late + [t for _, t in sorted(soon)]
            total = len(items)
            if total > 50:
                items = items[:50] + [f"… i {total - 50} więcej w aplikacji"]
            msg = notify.medical_email(u, items, len(late), len(soon))
            body = f"Badania nieważne: {len(late)}, kończą się w 30 dni: {len(soon)}"
            if _remind(db, u, "Badania lekarskie", body, "/", msg):
                sent += 1
    print(f"Przypomnienia o badaniach wysłane: {sent}.")
    return 0


def permit_reminders() -> int:
    """Cotygodniowe przypomnienie o dokumentach pobytowych (nieważne i kończące się w 60 dni)."""
    from sqlalchemy import select

    from app import notify
    from app.models import Role, User
    from app.routers.employees import format_number
    from app.routers.permits import KINDS, latest_permits, permit_state

    sent = 0
    with SessionLocal() as db:
        users = db.scalars(
            select(User).where(User.role.in_([Role.admin, Role.hr]), User.is_active).order_by(User.username)
        ).unique()
        for u in users:
            late: list[str] = []
            soon: list[tuple[object, str]] = []
            for x, e in latest_permits(db, u):
                st = permit_state(x.valid_until)
                if st == "valid":
                    continue
                kind = KINDS.get(x.kind, x.kind)
                who = f"{e.last_name} {e.first_name} (nr {format_number(e.number)}) – {kind}"
                if st == "expired":
                    late.append(f"{who}: nieważne od {x.valid_until:%d.%m.%Y}")
                else:
                    soon.append((x.valid_until, f"{who}: ważne do {x.valid_until:%d.%m.%Y}"))
            if not late and not soon:
                continue
            items = late + [t for _, t in sorted(soon, key=lambda p: p[0])]
            total = len(items)
            if total > 50:
                items = items[:50] + [f"… i {total - 50} więcej w aplikacji"]
            msg = notify.permits_email(u, items, len(late), len(soon))
            body = f"Dokumenty nieważne: {len(late)}, kończą się w 60 dni: {len(soon)}"
            if _remind(db, u, "Dokumenty pobytowe i zezwolenia", body, "/dokumenty-pobytowe", msg):
                sent += 1
    print(f"Przypomnienia o dokumentach pobytowych wysłane: {sent}.")
    return 0


def employee_reminders() -> int:
    """Cotygodniowe przypomnienie dla pracownika o jego terminach (badania, szkolenia, dokumenty pobytowe).

    Push na jego konto i/lub e-mail na potwierdzony adres – w języku pracownika."""
    from datetime import date, timedelta

    from sqlalchemy import select

    from app import crypto, i18n, mailer, push
    from app.emails import Email
    from app.models import Employee, EmployeeStatus, MedicalExam, Role, Training, User, WorkPermit

    today = date.today()
    sent = 0
    with SessionLocal() as db:
        accounts = {
            u.employee_id: u
            for u in db.scalars(
                select(User).where(User.role == Role.employee, User.is_active, User.employee_id.is_not(None))
            ).unique()
        }
        emps = db.scalars(
            select(Employee).where(
                Employee.status == EmployeeStatus.active,
                (Employee.id.in_(list(accounts))) | (Employee.email_verified_at.is_not(None)),
            )
        ).unique()
        for e in emps:
            acct = accounts.get(e.id)
            lang = acct.language if acct else None
            due: list[tuple[date, str, str]] = []  # (termin, szablon tekstu, nazwa)

            def add(until: date, label: str, name: str, days: int, due=due) -> None:
                if until <= today + timedelta(days=days):
                    due.append((until, label, name))

            exam = db.scalar(
                select(MedicalExam)
                .where(MedicalExam.employee_id == e.id, MedicalExam.valid_until.is_not(None))
                .order_by(MedicalExam.exam_date.desc())
                .limit(1)
            )
            if exam is not None:
                add(exam.valid_until, "Badania lekarskie", "", 30)
            for tr in db.scalars(
                select(Training).where(Training.employee_id == e.id, Training.valid_until.is_not(None))
            ).unique():
                add(tr.valid_until, "Szkolenie", tr.name or tr.type.name, 30)
            seen_kinds: set[str] = set()
            for pm in db.scalars(
                select(WorkPermit)
                .where(WorkPermit.employee_id == e.id)
                .order_by(WorkPermit.valid_until.desc())
            ):
                if pm.kind in seen_kinds:
                    continue
                seen_kinds.add(pm.kind)
                add(pm.valid_until, "Dokument pobytowy lub zezwolenie", "", 60)
            if not due:
                continue
            items = []
            for until, label, name in sorted(due):
                text = i18n.t(db, label, lang) + (f" – {name}" if name else "")
                if until < today:
                    text += ": " + i18n.t(db, "nieważne od {d}", lang, d=f"{until:%d.%m.%Y}")
                else:
                    text += ": " + i18n.t(db, "ważne do {d}", lang, d=f"{until:%d.%m.%Y}")
                items.append(text)
            title = i18n.t(db, "Zbliżają się Twoje terminy", lang)
            ok = False
            if acct is not None:
                try:
                    ok = "ok" in push.send_now(db, acct.id, title, "; ".join(items)[:200], "/moje-konto")
                except Exception as exc:  # noqa: BLE001
                    print(f"- pracownik {e.id}: błąd push: {exc}", file=sys.stderr)
            if e.email_enc and e.email_verified_at is not None and mailer.enabled():
                raw = Email(
                    subject="Zbliżają się Twoje terminy – Identyfikacja pracowników APT",
                    title="Zbliżają się Twoje terminy",
                    greeting="Dzień dobry {first_name},",
                    paragraphs=[
                        "poniższe terminy wkrótce się kończą albo już minęły. Skontaktuj się z kadrami."
                    ],
                    items=items,
                    tone="warning",
                )
                try:
                    em = i18n.tr_email(db, raw, lang, first_name=e.first_name)
                    mailer.send_now(crypto.decrypt_contact(e.email_enc), em)
                    ok = True
                except Exception as exc:  # noqa: BLE001
                    print(f"- pracownik {e.id}: błąd e-mail: {exc}", file=sys.stderr)
            sent += ok
    print(f"Przypomnienia dla pracowników wysłane: {sent}.")
    return 0


def stale_accounts() -> int:
    """Liczba aktywnych kont funkcyjnych bez logowania od STALE_DAYS dni (albo bez żadnego logowania)."""
    from datetime import timedelta

    from sqlalchemy import func, select

    from app.deps import utcnow
    from app.models import Role, User

    limit = utcnow() - timedelta(days=STALE_DAYS)
    with SessionLocal() as db:
        return (
            db.scalar(
                select(func.count()).where(
                    User.role != Role.employee,
                    User.is_active,
                    (User.last_login_at.is_(None) & (User.created_at < limit)) | (User.last_login_at < limit),
                )
            )
            or 0
        )


def restore_test_problems(now) -> list[str]:
    """Wynik cotygodniowego testu odtwarzania kopii (restore-test.sh); brak pliku = test nie ruszył."""
    import json
    from datetime import datetime, timedelta
    from pathlib import Path

    from app.config import get_settings

    try:
        r = json.loads((Path(get_settings().data_dir) / "restore-test.json").read_text())
        at = datetime.fromisoformat(r["at"])
    except (OSError, ValueError, KeyError):
        return []
    if not r.get("ok"):
        return [f"Test odtwarzania kopii zapasowej nie powiódł się: {str(r.get('info', ''))[:300]}"]
    if now - at > timedelta(days=15):
        return [f"Ostatni udany test odtwarzania kopii był {at:%d.%m.%Y} – sprawdź, czy kopie są wykonywane."]
    return []


def notify_daily() -> int:
    """Codzienne ostrzeżenia dla administratorów (wywoływane przez deploy/backup.sh)."""
    from datetime import UTC, datetime, timedelta
    from zoneinfo import ZoneInfo

    from app import notify
    from app.routers.dashboard import read_backup_status
    from app.routers.retention import count_due

    close_stale_threads()
    from app.routers.documents import purge_trash

    with SessionLocal() as db:
        purged = purge_trash(db)
    if purged:
        print(f"Z kosza usunięto trwale dokumentów: {purged}.")
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
    problems.extend(restore_test_problems(now))
    with SessionLocal() as db:
        due = count_due(db)
        if due:
            problems.append(
                f"Dane {due} os. mają za sobą okres przechowywania – usuń je w zakładce Retencja danych."
            )
    from app.routers.access_review import unusual_activity

    with SessionLocal() as db:
        problems.extend(unusual_activity(db))
    from app import lifecycle

    with SessionLocal() as db:
        applied = lifecycle.apply_due_changes(db)
    if applied:
        print(f"Wprowadzono zaplanowane zmiany: {applied}.")
    stamp_pending()  # uzupełnia znaczniki czasu, których nie udało się dodać od razu
    local = datetime.now(ZoneInfo("Europe/Warsaw"))
    if local.weekday() == 0:
        quality_reminders()
        training_reminders()
        medical_reminders()
        permit_reminders()
        employee_reminders()
        stale = stale_accounts()
        if stale:
            problems.append(
                f"Konta bez logowania od {STALE_DAYS} dni: {stale} – wyłącz je w „Przeglądzie dostępu”."
            )
        refresh_trustlist()
    if local.day == 1:
        agency_reports()
        if local.month in (1, 4, 7, 10):
            problems.append(
                "Kwartalny przegląd uprawnień: sprawdź konta, role i zakresy w menu „Przegląd dostępu”."
            )
    if not problems:
        print("Brak problemów – nie wysyłam.")
        return 0
    with SessionLocal() as db:
        from sqlalchemy import select

        from app.models import Role, User

        everyone = list(db.scalars(select(User).where(User.role == Role.admin, User.is_active)).unique())
        n = 0
        for a in everyone:
            msg = notify.admin_alert_email(problems, a) if a.email else None
            first = problems[0][:120] if problems else ""
            if _remind(db, a, "Aplikacja wymaga uwagi", first, "/", msg):
                n += 1
    print(f"Problemy: {len(problems)}, powiadomieni administratorzy: {n}.")
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
    sub.add_parser("notify-employees", help="Przypomnienie dla pracowników o ich terminach")
    sub.add_parser("notify-permits", help="Przypomnienie o dokumentach pobytowych i zezwoleniach")
    sub.add_parser("notify-daily", help="Ostrzeżenia dla administratorów (kopie, retencja)")
    sub.add_parser("notify-quality", help="Wyślij teraz przypomnienia o brakach w danych")
    sub.add_parser("notify-medical", help="Wyślij teraz przypomnienia o badaniach lekarskich")
    sub.add_parser("notify-trainings", help="Wyślij teraz przypomnienia o kończących się szkoleniach")
    sub.add_parser("agency-reports", help="Wyślij teraz zestawienia za poprzedni miesiąc do agencji")
    sub.add_parser("close-stale-threads", help="Zamknij rozmowy bez odpowiedzi pracownika")
    sub.add_parser("stamp-pending", help="Dodaj zaufane znaczniki czasu do podpisanych dokumentów")
    sub.add_parser("encrypt-files", help="Zaszyfruj pliki z danymi osobowymi na dysku (idempotentne)")
    sub.add_parser("refresh-trustlist", help="Pobierz unijną listę zaufania do weryfikacji podpisów")
    sub.add_parser("generate-key", help="Wygeneruj klucz APT_DATA_KEY do szyfrowania PESEL")
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        return create_admin(args.username, args.full_name)
    if args.command == "reset-mfa":
        return reset_mfa(args.username)
    if args.command == "send-test-mail":
        return send_test_mail(args.to)
    if args.command == "notify-employees":
        return employee_reminders()
    if args.command == "notify-permits":
        return permit_reminders()
    if args.command == "notify-daily":
        return notify_daily()
    if args.command == "notify-quality":
        return quality_reminders()
    if args.command == "notify-medical":
        return medical_reminders()
    if args.command == "notify-trainings":
        return training_reminders()
    if args.command == "agency-reports":
        return agency_reports()
    if args.command == "close-stale-threads":
        return close_stale_threads()
    if args.command == "stamp-pending":
        return stamp_pending()
    if args.command == "encrypt-files":
        return encrypt_files()
    if args.command == "refresh-trustlist":
        return refresh_trustlist()
    if args.command == "generate-key":
        from app.crypto import generate_key

        print(generate_key())
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
