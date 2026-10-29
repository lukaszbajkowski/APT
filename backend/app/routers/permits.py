"""Dokumenty pobytowe i uprawniające do pracy cudzoziemców: terminy ważności, alerty i zestawienie."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.audit import audit
from app.deps import AuthContext, DbSession, require_roles
from app.models import Employee, EmployeeStatus, Role, WorkPermit
from app.routers.employees import apply_scope, format_number, get_visible

router = APIRouter(prefix="/api", tags=["permits"])
PermitAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr))]

KINDS = {
    "karta_pobytu": "karta pobytu",
    "zezwolenie_na_prace": "zezwolenie na pracę",
    "wiza": "wiza",
    "oswiadczenie": "oświadczenie o powierzeniu pracy",
    "inne": "inny dokument",
}
EXPIRING_DAYS = 60


def permit_state(valid_until: date, today: date | None = None) -> str:
    today = today or date.today()
    if valid_until < today:
        return "expired"
    if (valid_until - today).days <= EXPIRING_DAYS:
        return "expiring"
    return "valid"


class PermitIn(BaseModel):
    kind: Literal["karta_pobytu", "zezwolenie_na_prace", "wiza", "oswiadczenie", "inne"]
    valid_from: date | None = None
    valid_until: date
    notes: str | None = Field(default=None, max_length=500)


class PermitOut(BaseModel):
    id: int
    kind: str
    kind_label: str
    valid_from: date | None
    valid_until: date
    state: str  # valid | expiring | expired
    days_left: int
    notes: str | None
    created_by_name: str | None
    created_at: datetime


def _out(x: WorkPermit) -> PermitOut:
    return PermitOut(
        id=x.id,
        kind=x.kind,
        kind_label=KINDS.get(x.kind, x.kind),
        valid_from=x.valid_from,
        valid_until=x.valid_until,
        state=permit_state(x.valid_until),
        days_left=(x.valid_until - date.today()).days,
        notes=x.notes,
        created_by_name=x.created_by_name,
        created_at=x.created_at,
    )


@router.get("/employees/{employee_id}/permits", response_model=list[PermitOut])
def list_permits(employee_id: int, ctx: PermitAuth, db: DbSession) -> list[PermitOut]:
    e = get_visible(db, ctx.user, employee_id)
    q = select(WorkPermit).where(WorkPermit.employee_id == e.id).order_by(WorkPermit.valid_until.desc())
    return [_out(x) for x in db.scalars(q)]


@router.post("/employees/{employee_id}/permits", response_model=PermitOut, status_code=201)
def add_permit(
    employee_id: int, body: PermitIn, ctx: PermitAuth, request: Request, db: DbSession
) -> PermitOut:
    e = get_visible(db, ctx.user, employee_id)
    if body.valid_from and body.valid_until < body.valid_from:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ważne do – nie wcześniej niż ważne od.")
    x = WorkPermit(
        employee_id=e.id,
        kind=body.kind,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        notes=(body.notes or "").strip() or None,
        created_by_name=ctx.user.full_name,
    )
    db.add(x)
    audit(
        db,
        request,
        "permit_added",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "kind": body.kind,
            "valid_until": body.valid_until.isoformat(),
        },
    )
    db.commit()
    db.refresh(x)
    return _out(x)


@router.delete("/permits/{permit_id}", status_code=204)
def delete_permit(permit_id: int, ctx: PermitAuth, request: Request, db: DbSession) -> Response:
    x = db.get(WorkPermit, permit_id)
    if x is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono dokumentu.")
    e = get_visible(db, ctx.user, x.employee_id)
    audit(
        db,
        request,
        "permit_deleted",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "kind": x.kind, "valid_until": x.valid_until.isoformat()},
    )
    db.delete(x)
    db.commit()
    return Response(status_code=204)


class PermitRow(BaseModel):
    employee_id: int
    number: str
    employee: str
    kind_label: str
    valid_until: date
    days_left: int
    state: str


def latest_permits(db, user, today: date | None = None) -> list[tuple[WorkPermit, Employee]]:
    """Najnowszy (najpóźniej ważny) dokument każdego aktywnego pracownika danego rodzaju."""
    q = (
        select(WorkPermit, Employee)
        .join(Employee, Employee.id == WorkPermit.employee_id)
        .where(Employee.status == EmployeeStatus.active)
        .order_by(WorkPermit.valid_until.desc())
    )
    seen: set[tuple[int, str]] = set()
    out: list[tuple[WorkPermit, Employee]] = []
    for x, e in db.execute(apply_scope(q, user)).unique().all():
        if (e.id, x.kind) in seen:
            continue
        seen.add((e.id, x.kind))
        out.append((x, e))
    return out


@router.get("/permits/report", response_model=list[PermitRow])
def report(ctx: PermitAuth, db: DbSession, only_problems: bool = True) -> list[PermitRow]:
    rows = []
    for x, e in latest_permits(db, ctx.user):
        st = permit_state(x.valid_until)
        if only_problems and st == "valid":
            continue
        rows.append(
            PermitRow(
                employee_id=e.id,
                number=format_number(e.number),
                employee=f"{e.last_name} {e.first_name}",
                kind_label=KINDS.get(x.kind, x.kind),
                valid_until=x.valid_until,
                days_left=(x.valid_until - date.today()).days,
                state=st,
            )
        )
    return sorted(rows, key=lambda r: (r.valid_until, r.employee))
