"""Strona startowa: liczniki i ostatnio dodani – w zakresie widoczności użytkownika."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.config import get_settings
from app.deps import Auth, DbSession
from app.models import AuditLog, Employee, EmployeeStatus, Photo, Role
from app.routers.employees import EmployeeOut, apply_scope, full_access, to_out
from app.routers.retention import count_due

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


class BackupRun(BaseModel):
    at: datetime
    ok: bool
    info: str = ""


class BackupStatus(BaseModel):
    local: BackupRun | None = None
    offsite: BackupRun | None = None


def read_backup_status() -> BackupStatus | None:
    """Wynik ostatniej kopii zapisany przez deploy/backup.sh (brak pliku = kopie nie działały)."""
    path = Path(get_settings().data_dir) / "backup-status.json"
    try:
        return BackupStatus.model_validate_json(path.read_text())
    except (OSError, ValueError):
        return None


class DashboardOut(BaseModel):
    active: int
    terminated: int
    added_30_days: int
    without_photo: int
    without_pesel: int | None  # tylko dla Administratora i Kadr
    cards_printed_30_days: int
    retention_due: int | None = None  # tylko dla Administratora
    backup: BackupStatus | None = None  # tylko dla Administratora
    recent: list[EmployeeOut]


@router.get("", response_model=DashboardOut)
def dashboard(ctx: Auth, db: DbSession) -> DashboardOut:
    user = ctx.user

    def count(*conditions) -> int:
        q = apply_scope(select(Employee.id).where(*conditions), user)
        return db.scalar(select(func.count()).select_from(q.subquery())) or 0

    active = Employee.status == EmployeeStatus.active
    month_ago = datetime.now(UTC) - timedelta(days=30)
    no_photo = ~select(Photo.id).where(Photo.employee_id == Employee.id).exists()

    cards = 0
    if user.role in (Role.admin, Role.hr):
        cards = (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "card_printed", AuditLog.ts >= month_ago)
            )
            or 0
        )
    recent = db.scalars(
        apply_scope(select(Employee), user).order_by(Employee.created_at.desc(), Employee.id.desc()).limit(6)
    ).unique()
    return DashboardOut(
        active=count(active),
        terminated=count(Employee.status == EmployeeStatus.terminated),
        added_30_days=count(Employee.created_at >= month_ago),
        without_photo=count(active, no_photo),
        without_pesel=count(active, Employee.pesel_hash.is_(None)) if full_access(user) else None,
        cards_printed_30_days=cards,
        recent=[to_out(e, user) for e in recent],
        retention_due=count_due(db) if user.role == Role.admin else None,
        backup=read_backup_status() if user.role == Role.admin else None,
    )
