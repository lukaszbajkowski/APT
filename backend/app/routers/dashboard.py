"""Strona startowa: liczniki i ostatnio dodani – w zakresie widoczności użytkownika."""

from datetime import UTC, date, datetime, timedelta
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


# --- nadchodzące zdarzenia ---------------------------------------------------------


class UpcomingEvent(BaseModel):
    date: date
    kind: str  # exam | start | standard_end | valid_until | hire | transfer | task | task_overdue
    title: str
    employee_id: int
    employee: str


UPCOMING_DAYS = 14


@router.get("/upcoming", response_model=list[UpcomingEvent])
def upcoming(ctx: Auth, db: DbSession, days: int = UPCOMING_DAYS) -> list[UpcomingEvent]:
    """Egzaminy, starty i końce standardu szkoleń, końce ważności, pierwsze dni pracy – najbliższe dni."""
    from app.models import Training

    today = date.today()
    end = today + timedelta(days=max(1, min(days, 60)))
    out: list[UpcomingEvent] = []

    def add(d: date | None, kind: str, title: str, e: Employee) -> None:
        if d is not None and today <= d <= end:
            out.append(
                UpcomingEvent(
                    date=d, kind=kind, title=title, employee_id=e.id, employee=f"{e.last_name} {e.first_name}"
                )
            )

    from app.models import MedicalExam

    mq = (
        select(MedicalExam, Employee)
        .join(Employee, Employee.id == MedicalExam.employee_id)
        .where(Employee.status == EmployeeStatus.active, MedicalExam.valid_until.is_not(None))
        .order_by(MedicalExam.exam_date.desc())
    )
    seen: set[int] = set()
    for x, e in db.execute(apply_scope(mq, ctx.user)).unique().all():
        if e.id in seen:  # liczy się tylko najnowsze badanie
            continue
        seen.add(e.id)
        if x.valid_until < today:
            out.append(
                UpcomingEvent(
                    date=today,
                    kind="medical_expired",
                    title="Badania lekarskie nieważne",
                    employee_id=e.id,
                    employee=f"{e.last_name} {e.first_name}",
                )  # fmt: skip
            )
        else:
            add(x.valid_until, "medical", "Kończą się badania lekarskie", e)
    if ctx.user.role == Role.agency:  # agencja: tylko badania
        return sorted(out, key=lambda x: (x.date, x.kind, x.employee))[:100]

    q = (
        select(Training, Employee)
        .join(Employee, Employee.id == Training.employee_id)
        .where(Employee.status == EmployeeStatus.active)
    )
    for tr, e in db.execute(apply_scope(q, ctx.user)).unique().all():
        label = tr.name or tr.type.name
        finished = (tr.end_date is not None and tr.end_date <= today) or tr.completed_on is not None
        add(tr.exam_date, "exam", f"Egzamin: {label}", e)
        add(tr.start_date, "start", f"Początek szkolenia: {label}", e)
        if tr.start_date and tr.standard_days is not None and not finished:
            add(
                tr.start_date + timedelta(days=tr.standard_days),
                "standard_end",
                f"Koniec standardu: {label}",
                e,
            )
        add(tr.valid_until, "valid_until", f"Kończy się ważność: {label}", e)
    hires = select(Employee).where(
        Employee.status == EmployeeStatus.active, Employee.hire_date >= today, Employee.hire_date <= end
    )
    for e in db.scalars(apply_scope(hires, ctx.user)).unique():
        add(e.hire_date, "hire", "Pierwszy dzień pracy", e)
    from app.routers.lifecycle import pending_q, planned_out

    for pc in db.scalars(pending_q()):
        if pc.effective_date > end:
            break
        e = db.scalar(apply_scope(select(Employee).where(Employee.id == pc.employee_id), ctx.user))
        if e is not None:
            p = planned_out(db, pc)
            what = " · ".join(x for x in (p.department, p.position, p.agency) if x)
            add(pc.effective_date, "transfer", f"Przeniesienie: {what}", e)
    if ctx.user.role != Role.viewer:
        from app.routers.lifecycle import open_tasks

        for t in open_tasks(db, ctx.user):
            if t.due_date and t.due_date <= end:
                due = max(t.due_date, today)  # zaległe pokazujemy jako „dziś”
                out.append(
                    UpcomingEvent(
                        date=due,
                        kind="task_overdue" if t.state == "overdue" else "task",
                        title=t.label,
                        employee_id=t.employee_id,
                        employee=t.employee,
                    )  # fmt: skip
                )
    return sorted(out, key=lambda x: (x.date, x.kind, x.employee))[:100]
