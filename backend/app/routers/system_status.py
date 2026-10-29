"""Stan systemu dla administratora: kopie, test odtwarzania, miejsce na dysku, tłumaczenia, retencja."""

import json
import shutil
from datetime import datetime
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
    )
