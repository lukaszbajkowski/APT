"""Stan systemu dla administratora: kopie, test odtwarzania, miejsce na dysku, tłumaczenia, retencja."""

import json
import shutil
import smtplib
from datetime import datetime
from email.utils import parseaddr
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app import translate
from app.config import get_settings
from app.deps import AdminAuth, DbSession
from app.routers.access_review import unusual_activity
from app.routers.dashboard import BackupStatus, read_backup_status
from app.routers.retention import count_due

router = APIRouter(prefix="/api/system", tags=["system"])


class RestoreTest(BaseModel):
    at: datetime
    ok: bool
    info: str = ""


class Disk(BaseModel):
    total_gb: float
    free_gb: float
    used_percent: int


class Translation(BaseModel):
    enabled: bool
    used: int
    limit: int


class SystemStatus(BaseModel):
    version: str
    migration: str | None
    backup: BackupStatus | None
    restore_test: RestoreTest | None
    disk: Disk | None
    translation: Translation
    retention_due: int
    unusual: list[str]
    mail_enabled: bool
    mail_from: str = ""


def read_restore_test() -> RestoreTest | None:
    path = Path(get_settings().data_dir) / "restore-test.json"
    try:
        return RestoreTest.model_validate(json.loads(path.read_text()))
    except (OSError, ValueError):
        return None


@router.get("/status", response_model=SystemStatus)
def status(ctx: AdminAuth, db: DbSession) -> SystemStatus:
    from app import mailer
    from app.main import app

    s = get_settings()
    try:
        du = shutil.disk_usage(s.data_dir)
        disk: Disk | None = Disk(
            total_gb=round(du.total / 1e9, 1),
            free_gb=round(du.free / 1e9, 1),
            used_percent=round(100 * (du.total - du.free) / du.total) if du.total else 0,
        )
    except OSError:
        disk = None
    try:
        migration = db.scalar(text("select version_num from alembic_version"))
    except Exception:  # noqa: BLE001
        migration = None
    return SystemStatus(
        version=app.version,
        migration=migration,
        backup=read_backup_status(),
        restore_test=read_restore_test(),
        disk=disk,
        translation=Translation(
            enabled=translate.enabled(),
            used=translate.used_this_month(db) if translate.enabled() else 0,
            limit=s.translate_monthly_chars,
        ),
        retention_due=count_due(db),
        unusual=unusual_activity(db),
        mail_enabled=mailer.enabled(),
        mail_from=parseaddr(s.mail_from)[1] if mailer.enabled() else "",
    )


class TestMailResult(BaseModel):
    ok: bool
    to: str = ""
    error: str = ""


def _mail_error(e: Exception) -> str:
    """Błąd wysyłki po polsku z podpowiedzią, co sprawdzić w .env – bez haseł."""
    s = get_settings()
    if isinstance(e, smtplib.SMTPAuthenticationError):
        return (
            f"Serwer poczty odrzucił logowanie ({e.smtp_code}). "
            "Sprawdź APT_SMTP_USER i APT_SMTP_PASSWORD w pliku .env."
        )
    if isinstance(e, smtplib.SMTPSenderRefused):
        return f"Serwer poczty odrzucił nadawcę ({e.smtp_code}). Sprawdź APT_MAIL_FROM w pliku .env."
    if isinstance(e, smtplib.SMTPRecipientsRefused):
        return "Serwer poczty odrzucił adres odbiorcy. Sprawdź adres e-mail w swoim koncie."
    if isinstance(e, smtplib.SMTPResponseException):
        return f"Serwer poczty zwrócił błąd {e.smtp_code}. Sprawdź ustawienia APT_SMTP_* w pliku .env."
    if isinstance(e, (smtplib.SMTPException, OSError)):
        return (
            f"Nie udało się połączyć z serwerem poczty ({s.smtp_host}:{s.smtp_port}). "
            "Sprawdź APT_SMTP_HOST, APT_SMTP_PORT i APT_SMTP_SECURITY w pliku .env."
        )
    return "Nie udało się wysłać wiadomości testowej."


@router.post("/test-mail", response_model=TestMailResult)
def test_mail(ctx: AdminAuth) -> TestMailResult:
    """Wysyła wiadomość testową na adres zalogowanego administratora (sprawdzenie ustawień poczty)."""
    from app import mailer, notify

    if not mailer.enabled():
        return TestMailResult(
            ok=False, error="Wysyłka wyłączona: ustaw APT_SMTP_HOST i APT_MAIL_FROM w pliku .env."
        )
    to = ctx.user.email
    if not to:
        return TestMailResult(ok=False, error="Twoje konto nie ma adresu e-mail – dodaj go w „Moje konto”.")
    try:
        mailer.send_now(to, notify.test_email())
    except Exception as e:  # noqa: BLE001
        return TestMailResult(ok=False, to=to, error=_mail_error(e))
    return TestMailResult(ok=True, to=to)
