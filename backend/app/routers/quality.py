"""Jakość danych: aktywni pracownicy z brakami w kartotece."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, DbSession, require_roles
from app.models import Employee, EmployeeStatus, Role, User
from app.routers.employees import apply_scope, format_number, full_access

router = APIRouter(prefix="/api/quality", tags=["quality"])
QualityAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]

# kolejność = kolejność wyświetlania
CHECKS: dict[str, str] = {
    "pesel": "Brak PESEL",
    "sex": "Brak płci",
    "photo": "Brak zdjęcia",
    "department": "Brak wydziału",
    "position": "Brak stanowiska",
}


def visible_checks(user: User) -> list[str]:
    # kierownik nie widzi PESEL, więc nie zgłaszamy mu tego braku
    return [k for k in CHECKS if k != "pesel" or full_access(user)]


def missing(e: Employee, checks: list[str]) -> list[str]:
    out = []
    for k in checks:
        if (
            (k == "pesel" and e.pesel_hash is None)
            or (k == "sex" and e.sex is None)
            or (k == "photo" and e.photo is None)
            or (k == "department" and e.department_id is None)
            or (k == "position" and e.position_id is None)
        ):
            out.append(k)
    return out


def collect(db: Session, user: User) -> tuple[list[str], list[tuple[Employee, list[str]]]]:
    checks = visible_checks(user)
    q = apply_scope(select(Employee).where(Employee.status == EmployeeStatus.active), user)
    q = q.order_by(Employee.last_name, Employee.first_name)
    rows = []
    for e in db.scalars(q).unique():
        m = missing(e, checks)
        if m:
            rows.append((e, m))
    return checks, rows


class CheckOut(BaseModel):
    key: str
    label: str
    count: int


class RowOut(BaseModel):
    id: int
    number: str
    last_name: str
    first_name: str
    agency: str | None
    department: str | None
    missing: list[str]


class QualityOut(BaseModel):
    active_total: int
    checks: list[CheckOut]
    rows: list[RowOut]


def summary(db: Session, user: User) -> QualityOut:
    checks, rows = collect(db, user)
    total_q = apply_scope(select(Employee.id).where(Employee.status == EmployeeStatus.active), user)
    total = len(db.scalars(total_q).all())
    counts: dict[str, int] = {k: 0 for k in checks}
    for _, m in rows:
        for k in m:
            counts[k] += 1
    return QualityOut(
        active_total=total,
        checks=[CheckOut(key=k, label=CHECKS[k], count=counts[k]) for k in checks],
        rows=[
            RowOut(
                id=e.id,
                number=format_number(e.number),
                last_name=e.last_name,
                first_name=e.first_name,
                agency=e.agency.name if e.agency else None,
                department=e.department.name if e.department else None,
                missing=m,
            )
            for e, m in rows
        ],
    )


@router.get("", response_model=QualityOut)
def get_quality(ctx: QualityAuth, db: DbSession) -> QualityOut:
    return summary(db, ctx.user)
