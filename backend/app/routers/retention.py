"""Retencja danych: przegląd i trwałe usuwanie danych po okresie przechowywania."""

import shutil
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import photos, retention
from app.audit import audit
from app.config import get_settings
from app.deps import AdminAuth, DbSession
from app.models import Employee, EmployeeStatus
from app.routers.employees import format_number

router = APIRouter(prefix="/api/retention", tags=["retention"])

CONFIRM_WORD = "USUŃ"
UPCOMING_DAYS = 365


class RetentionItem(BaseModel):
    id: int
    number: str
    name: str
    agency: str | None
    termination_date: date | None
    retention_end: date | None
    delete_after: date | None
    hold_until: date | None
    hold_reason: str | None


class RetentionOut(BaseModel):
    years: int
    today: date
    due: list[RetentionItem]
    upcoming: list[RetentionItem]
    held: list[RetentionItem]
    missing_date: list[RetentionItem]


class PurgeIn(BaseModel):
    employee_ids: list[int] = Field(min_length=1, max_length=1000)
    confirm: str


class PurgeOut(BaseModel):
    deleted: int


class HoldIn(BaseModel):
    until: date | None = None
    reason: str | None = Field(default=None, max_length=500)


def _item(e: Employee) -> RetentionItem:
    return RetentionItem(
        id=e.id,
        number=format_number(e.number),
        name=f"{e.last_name} {e.first_name}",
        agency=e.agency.name if e.agency else None,
        termination_date=e.termination_date,
        retention_end=retention.retention_end(e.termination_date),
        delete_after=retention.delete_after(e),
        hold_until=e.retention_hold_until,
        hold_reason=e.retention_hold_reason,
    )


def _bucket(e: Employee, today: date) -> Literal["due", "upcoming", "held", "missing", "later"]:
    after = retention.delete_after(e)
    if after is None:
        return "missing"
    if today > after:
        return "due"
    end = retention.retention_end(e.termination_date)
    if e.retention_hold_until and end is not None and today > end:
        return "held"
    if after <= today + timedelta(days=UPCOMING_DAYS):
        return "upcoming"
    return "later"


def count_due(db: DbSession, today: date | None = None) -> int:
    today = today or date.today()
    terminated = db.scalars(select(Employee).where(Employee.status == EmployeeStatus.terminated)).unique()
    return sum(1 for e in terminated if retention.is_due(e, today))


@router.get("", response_model=RetentionOut)
def overview(ctx: AdminAuth, db: DbSession) -> RetentionOut:
    today = date.today()
    out: dict[str, list[RetentionItem]] = {"due": [], "upcoming": [], "held": [], "missing": []}
    terminated = db.scalars(
        select(Employee)
        .where(Employee.status == EmployeeStatus.terminated)
        .order_by(Employee.termination_date.asc().nulls_first(), Employee.last_name, Employee.first_name)
    ).unique()
    for e in terminated:
        bucket = _bucket(e, today)
        if bucket != "later":
            out[bucket].append(_item(e))
    return RetentionOut(
        years=get_settings().retention_years,
        today=today,
        due=out["due"],
        upcoming=sorted(out["upcoming"], key=lambda i: i.delete_after or today),
        held=out["held"],
        missing_date=out["missing"],
    )


def _remove_files(employee_id: int, photo_file: str | None) -> None:
    if photo_file:
        photos.delete(photo_file)
    docs = Path(get_settings().data_dir) / "documents" / str(employee_id)
    shutil.rmtree(docs, ignore_errors=True)


@router.post("/purge", response_model=PurgeOut)
def purge(body: PurgeIn, ctx: AdminAuth, request: Request, db: DbSession) -> PurgeOut:
    """Trwałe usunięcie danych osób, którym minął okres przechowywania."""
    if body.confirm.strip().upper() != CONFIRM_WORD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Aby potwierdzić, wpisz {CONFIRM_WORD}.")
    today = date.today()
    ids = sorted(set(body.employee_ids))
    emps = list(db.scalars(select(Employee).where(Employee.id.in_(ids))).unique())
    if len(emps) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Część pracowników już nie istnieje.")
    not_due = [format_number(e.number) for e in emps if not retention.is_due(e, today)]
    if not_due:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Okres przechowywania jeszcze nie minął: {', '.join(not_due[:10])}.",
        )

    files: list[tuple[int, str | None]] = []
    for e in emps:
        files.append((e.id, e.photo.file_name if e.photo else None))
        # w dzienniku zostaje tylko numer ewidencyjny i daty – bez danych osobowych
        audit(
            db,
            request,
            "employee_purged",
            user=ctx.user,
            entity_type="employee",
            entity_id=e.id,
            details={
                "number": format_number(e.number),
                "termination_date": e.termination_date.isoformat() if e.termination_date else None,
                "retention_end": str(retention.retention_end(e.termination_date)),
            },
        )
        db.delete(e)
    audit(db, request, "retention_purge", user=ctx.user, details={"count": len(emps)})
    db.commit()
    # pliki usuwamy dopiero po udanym zapisie w bazie
    for employee_id, photo_file in files:
        _remove_files(employee_id, photo_file)
    return PurgeOut(deleted=len(emps))


@router.post("/{employee_id}/hold", response_model=RetentionItem)
def hold(employee_id: int, body: HoldIn, ctx: AdminAuth, request: Request, db: DbSession) -> RetentionItem:
    """Wstrzymanie usunięcia do podanej daty (np. postępowanie sądowe) albo jego zniesienie."""
    e = db.get(Employee, employee_id)
    if e is None or e.status != EmployeeStatus.terminated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika w archiwum.")
    if body.until is not None:
        if body.until <= date.today():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Data wstrzymania musi być w przyszłości."
            )
        reason = (body.reason or "").strip()
        if not reason:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Podaj powód wstrzymania.")
        e.retention_hold_until = body.until
        e.retention_hold_reason = reason
        action = "retention_hold_set"
        details = {"number": format_number(e.number), "until": body.until.isoformat(), "reason": reason}
    else:
        e.retention_hold_until = None
        e.retention_hold_reason = None
        action = "retention_hold_cleared"
        details = {"number": format_number(e.number)}
    audit(db, request, action, user=ctx.user, entity_type="employee", entity_id=e.id, details=details)
    db.commit()
    db.refresh(e)
    return _item(e)
