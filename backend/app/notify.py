"""Treści e-maili i jednorazowe linki do ustawienia hasła."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import mailer
from app.emails import Email
from app.models import ROLE_LABELS, PasswordToken, Role, User
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


def find_token(
    db: Session, token: str, now: datetime, *, employee_invite: bool = False
) -> PasswordToken | None:
    """Jednorazowy link. Zaproszenia pracowników (klucz dostępu) i linki do haseł to osobne światy:
    jeden rodzaj nigdy nie otwiera drugiego."""
    t = db.scalar(select(PasswordToken).where(PasswordToken.token_hash == token_hash(token)))
    if t is None or t.used_at is not None or t.expires_at <= now or not t.user.is_active:
        return None
    if (t.purpose == "empinvite") != employee_invite:
        return None
    return t


def reset_email(user: User, token: str) -> Email:
    return Email(
        subject="Reset hasła – Identyfikacja pracowników APT",
        title="Ustaw nowe hasło",
        preheader=f"Link do ustawienia nowego hasła jest ważny {RESET_MINUTES} minut.",
        greeting=f"Dzień dobry {user.full_name},",
        paragraphs=[
            f"ktoś (prawdopodobnie Ty) poprosił o reset hasła do konta „{user.username}”. "
            "Kliknij przycisk, aby ustawić nowe hasło."
        ],
        button=("Ustaw nowe hasło", mailer.link("/ustaw-haslo?token=" + token)),
        notice=f"Link jest ważny {RESET_MINUTES} minut i działa tylko raz. "
        "Logowanie dwuetapowe (kod z telefonu) nadal obowiązuje.",
        footer_note="Jeśli to nie Ty – zignoruj tę wiadomość. Twoje hasło się nie zmieni.",
    )


def invite_email(user: User, token: str) -> Email:
    return Email(
        subject="Twoje konto w aplikacji Identyfikacja pracowników APT",
        title="Witaj w aplikacji",
        preheader="Ustaw hasło do swojego konta.",
        greeting=f"Dzień dobry {user.full_name},",
        paragraphs=["założono dla Ciebie konto w aplikacji Identyfikacja pracowników APT."],
        details=[("Login", user.username), ("Rola", ROLE_LABELS.get(user.role, user.role.value))],
        button=("Ustaw hasło", mailer.link("/ustaw-haslo?token=" + token)),
        notice=f"Link jest ważny {INVITE_HOURS} godziny. Po jego wygaśnięciu poproś administratora o nowy.",
        footer_note=f"Logowanie do aplikacji: {mailer.link('/login')}",
    )


def security_email(user: User, what: str) -> Email:
    return Email(
        subject=f"Bezpieczeństwo konta: {what}",
        title="Zmiana na Twoim koncie",
        preheader=what[:1].upper() + what[1:] + ".",
        greeting=f"Dzień dobry {user.full_name},",
        paragraphs=[f"na Twoim koncie „{user.username}”: {what}."],
        details=[
            ("Konto", user.username),
            ("Kiedy", datetime.now(ZoneInfo("Europe/Warsaw")).strftime("%d.%m.%Y, %H:%M")),
        ],
        notice="Jeśli to nie Ty – natychmiast skontaktuj się z administratorem aplikacji.",
        tone="warning",
    )


def _for(path: str, user: User | None) -> str:
    """Link do aplikacji z numerem konta adresata – aplikacja przełączy się na nie, jeśli jest zalogowane."""
    return mailer.link(path + (("&" if "?" in path else "?") + f"u={user.id}" if user is not None else ""))


def admin_alert_email(problems: list[str], user: User | None = None) -> Email:
    return Email(
        subject="Identyfikacja APT – wymaga uwagi",
        title="Wymaga uwagi administratora",
        preheader=problems[0] if problems else "",
        paragraphs=["Codzienne sprawdzenie aplikacji znalazło sprawy do załatwienia:"],
        items=problems,
        button=("Otwórz aplikację", _for("/", user)),
        tone="danger" if any("kopi" in p.lower() for p in problems) else "warning",
        footer_note="Tę wiadomość dostają administratorzy z wpisanym adresem e-mail.",
    )


def quality_email(user: User, counts: list[tuple[str, int]], people: int) -> Email:
    return Email(
        subject=f"Identyfikacja APT – braki w danych ({people} os.)",
        title="Braki w danych pracowników",
        preheader=f"{people} aktywnych pracowników ma niekompletne dane.",
        paragraphs=[
            f"Dzień dobry {user.full_name},",
            f"w Twoim zakresie {people} aktywnych pracowników ma niekompletne dane w kartotece:",
        ],
        items=[f"{label}: {n}" for label, n in counts if n],
        button=("Zobacz braki", _for("/braki", user)),
        tone="warning",
        footer_note="Przypomnienie wysyłane w poniedziałki, gdy w danych są braki.",
    )


def trainings_email(user: User, items: list[str], expired: int, overdue: int, expiring: int) -> Email:
    parts = []
    if overdue:
        parts.append(f"{overdue} szkoleń stanowiskowych trwa dłużej niż standard")
    if expiring:
        parts.append(
            f"{expiring} ważności kończy się w ciągu 30 dni"
            + (f" (w tym {expired} już wygasło)" if expired else "")
        )
    return Email(
        subject=f"Identyfikacja APT – szkolenia wymagające uwagi ({overdue + expiring})",
        title="Szkolenia wymagające uwagi",
        preheader="; ".join(parts),
        paragraphs=[f"Dzień dobry {user.full_name},", "w Twoim zakresie: " + "; ".join(parts) + "."],
        items=items,
        button=("Zobacz szkolenia", _for("/szkolenia", user)),
        tone="danger" if expired or overdue else "warning",
        footer_note="Przypomnienie wysyłane w poniedziałki, gdy coś wymaga uwagi.",
    )


def medical_email(user: User, items: list[str], expired: int, expiring: int) -> Email:
    parts = []
    if expired:
        parts.append(f"{expired} badań jest już nieważnych")
    if expiring:
        parts.append(f"{expiring} badań kończy się w ciągu 30 dni")
    return Email(
        subject=f"Identyfikacja APT – badania lekarskie wymagające uwagi ({expired + expiring})",
        title="Badania lekarskie wymagające uwagi",
        preheader="; ".join(parts),
        paragraphs=[f"Dzień dobry {user.full_name},", "w Twoim zakresie: " + "; ".join(parts) + "."],
        items=items,
        button=("Otwórz aplikację", _for("/", user)),
        tone="danger" if expired else "warning",
        footer_note="Przypomnienie wysyłane w poniedziałki, gdy coś wymaga uwagi.",
    )


def sign_request_email(person: str, document: str, url: str, expires: datetime) -> Email:
    when = expires.astimezone(ZoneInfo("Europe/Warsaw")).strftime("%d.%m.%Y, %H:%M")
    return Email(
        subject=f"Prośba o podpis: {document}",
        title="Dokument do podpisu",
        preheader=f"Podpisz dokument „{document}” na swoim telefonie lub komputerze.",
        greeting=f"Dzień dobry {person},",
        paragraphs=[
            f"prosimy o podpisanie dokumentu „{document}”. Kliknij przycisk, przeczytaj dokument "
            "i podpisz się palcem na ekranie telefonu (albo myszką na komputerze)."
        ],
        button=("Otwórz i podpisz", url),
        notice=f"Link jest osobisty i ważny do {when}. Nie przekazuj go innym osobom.",
        footer_note="Jeśli nie spodziewasz się tej wiadomości – zignoruj ją.",
    )


def account_sign_email(first_name: str, document: str, url: str) -> Email:
    return Email(
        subject=f"Nowy dokument do podpisu: {document}",
        title="Dokument czeka na Twój podpis",
        preheader=f"Zaloguj się do konta, aby podpisać „{document}”.",
        greeting=f"Dzień dobry {first_name},",
        paragraphs=[
            f"w Twoim koncie czeka dokument „{document}”. Zaloguj się (twarzą, odciskiem palca lub PIN-em), "
            "przeczytaj go i podpisz w zakładce „Do podpisu”.",
        ],
        button=("Przejdź do konta", url),
        footer_note="Jeśli nie spodziewasz się tej wiadomości – zignoruj ją.",
    )


def test_email() -> Email:
    return Email(
        subject="Test – Identyfikacja pracowników APT",
        title="E-maile działają",
        paragraphs=["To jest wiadomość testowa. Wysyłka e-maili z aplikacji jest poprawnie skonfigurowana."],
        button=("Otwórz aplikację", mailer.link("/")),
        tone="success",
    )


def send_reset(user: User, token: str) -> None:
    mailer.send(user.email, reset_email(user, token))


def send_invite(user: User, token: str) -> None:
    mailer.send(user.email, invite_email(user, token))


def security_notice(user: User, what: str) -> None:
    """Informacja dla właściciela konta o ważnej zmianie (np. hasło, blokada, 2FA)."""
    mailer.send(user.email, security_email(user, what))


def admins_with_email(db: Session) -> list[User]:
    return list(
        db.scalars(select(User).where(User.role == Role.admin, User.is_active, User.email.is_not(None)))
    )
