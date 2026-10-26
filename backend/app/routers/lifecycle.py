"""Cykl życia pracownika: przebieg zatrudnienia, ponowne zatrudnienie, checklisty i zadania."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import lifecycle
from app.audit import audit
from app.deps import AuthContext, DbSession, get_auth, require_roles
from app.models import (
    Agency,
    Assignment,
    ChecklistItem,
    ChecklistTemplateItem,
    Department,
    DocumentTemplate,
    Employee,
    EmployeeStatus,
    EmploymentPeriod,
    Position,
    Role,
    TrainingType,
    User,
)
from app.routers.employees import EmployeeOut, apply_scope, format_number, get_visible, to_out

router = APIRouter(prefix="/api", tags=["lifecycle"])
AnyAuth = Annotated[AuthContext, Depends(get_auth)]
StaffAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr))]
WorkAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]
Kind = Literal["onboarding", "offboarding"]


# ---------- przebieg zatrudnienia ----------


class PeriodOut(BaseModel):
    hire_date: date | None
    termination_date: date | None
    agency: str | None
    department: str | None
    position: str | None
    current: bool


class AssignmentOut(BaseModel):
    valid_from: date
    agency: str | None
    department: str | None
    position: str | None
    reason: str | None
    changed_by: str | None


class TimelineOut(BaseModel):
    periods: list[PeriodOut]
    assignments: list[AssignmentOut]


@router.get("/employees/{employee_id}/timeline", response_model=TimelineOut)
def timeline(employee_id: int, ctx: AnyAuth, db: DbSession) -> TimelineOut:
    e = get_visible(db, ctx.user, employee_id)
    past = db.scalars(
        select(EmploymentPeriod)
        .where(EmploymentPeriod.employee_id == e.id)
        .order_by(EmploymentPeriod.hire_date)
    )
    periods = [
        PeriodOut(
            hire_date=p.hire_date,
            termination_date=p.termination_date,
            agency=p.agency_name,
            department=p.department_name,
            position=p.position_name,
            current=False,
        )
        for p in past
    ]
    periods.append(
        PeriodOut(
            hire_date=e.hire_date,
            termination_date=e.termination_date,
            agency=e.agency.name if e.agency else None,
            department=e.department.name if e.department else None,
            position=e.position.name if e.position else None,
            current=True,
        )
    )
    rows = db.scalars(
        select(Assignment)
        .where(Assignment.employee_id == e.id)
        .order_by(Assignment.valid_from.desc(), Assignment.id.desc())
    )
    return TimelineOut(
        periods=list(reversed(periods)),
        assignments=[
            AssignmentOut(
                valid_from=a.valid_from,
                agency=a.agency_name,
                department=a.department_name,
                position=a.position_name,
                reason=a.reason,
                changed_by=a.changed_by_name,
            )
            for a in rows
        ],
    )


# ---------- ponowne zatrudnienie ----------


class RehireIn(BaseModel):
    hire_date: date
    agency_id: int | None = None
    department_id: int | None = None
    position_id: int | None = None
    checklist: bool = True


@router.post("/employees/{employee_id}/rehire", response_model=EmployeeOut)
def rehire(employee_id: int, body: RehireIn, ctx: StaffAuth, request: Request, db: DbSession) -> EmployeeOut:
    e = get_visible(db, ctx.user, employee_id)
    if e.status != EmployeeStatus.terminated:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Pracownik jest aktywny.")
    if e.termination_date and body.hire_date <= e.termination_date:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Data zatrudnienia musi być po dacie zwolnienia ({e.termination_date:%d.%m.%Y}).",
        )
    for model, ref, label in (
        (Agency, body.agency_id, "APT"),
        (Department, body.department_id, "wydziału"),
        (Position, body.position_id, "stanowiska"),
    ):
        if ref is not None and db.get(model, ref) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Nie ma takiego {label}.")
    db.add(
        EmploymentPeriod(
            employee_id=e.id,
            hire_date=e.hire_date,
            termination_date=e.termination_date,
            agency_name=e.agency.name if e.agency else None,
            department_name=e.department.name if e.department else None,
            position_name=e.position.name if e.position else None,
        )
    )
    previous = (e.hire_date, e.termination_date)
    e.status = EmployeeStatus.active
    e.hire_date = body.hire_date
    e.termination_date = None
    e.retention_hold_until = None
    e.retention_hold_reason = None
    e.agency_id, e.department_id, e.position_id = body.agency_id, body.department_id, body.position_id
    db.flush()
    db.refresh(e)
    lifecycle.record_assignment(db, e, body.hire_date, "ponowne zatrudnienie", ctx.user.full_name)
    db.execute(
        delete(ChecklistItem).where(ChecklistItem.employee_id == e.id, ChecklistItem.kind == "offboarding")
    )
    if body.checklist:
        lifecycle.create_checklist(db, e, "onboarding", body.hire_date)
    audit(
        db,
        request,
        "employee_rehired",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "hire_date": body.hire_date.isoformat(),
            "previous_period": [d.isoformat() if d else None for d in previous],
        },
    )
    db.commit()
    db.refresh(e)
    return to_out(e, ctx.user)


# ---------- checklisty pracownika ----------


class ItemOut(BaseModel):
    id: int
    kind: str
    label: str
    responsible: str
    due_date: date | None
    auto: str | None
    state: str  # done | auto | skipped | overdue | open
    done_at: datetime | None
    done_by_name: str | None
    note: str | None
    can_edit: bool


class ChecklistsOut(BaseModel):
    onboarding: list[ItemOut]
    offboarding: list[ItemOut]


def _can_edit(user: User, it: ChecklistItem) -> bool:
    return user.role in (Role.admin, Role.hr) or (user.role == Role.manager and it.responsible == "manager")


def _item_out(db: Session, it: ChecklistItem, e: Employee, user: User) -> ItemOut:
    return ItemOut(
        id=it.id,
        kind=it.kind,
        label=it.label,
        responsible=it.responsible,
        due_date=it.due_date,
        auto=it.auto,
        state=lifecycle.item_state(db, it, e),
        done_at=it.done_at,
        done_by_name=it.done_by_name,
        note=it.note,
        can_edit=_can_edit(user, it),
    )


def _items(db: Session, e: Employee, user: User) -> ChecklistsOut:
    rows = db.scalars(
        select(ChecklistItem)
        .where(ChecklistItem.employee_id == e.id)
        .order_by(ChecklistItem.sort, ChecklistItem.id)
    )
    out = ChecklistsOut(onboarding=[], offboarding=[])
    for it in rows:
        getattr(out, it.kind).append(_item_out(db, it, e, user))
    return out


@router.get("/employees/{employee_id}/checklists", response_model=ChecklistsOut)
def get_checklists(employee_id: int, ctx: WorkAuth, db: DbSession) -> ChecklistsOut:
    e = get_visible(db, ctx.user, employee_id)
    return _items(db, e, ctx.user)


@router.post("/employees/{employee_id}/checklists/{kind}", response_model=ChecklistsOut)
def create_checklist(
    employee_id: int, kind: Kind, ctx: StaffAuth, request: Request, db: DbSession
) -> ChecklistsOut:
    e = get_visible(db, ctx.user, employee_id)
    base = e.hire_date if kind == "onboarding" else e.termination_date
    items = lifecycle.create_checklist(db, e, kind, base)
    if not items:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Szablon tej checklisty jest pusty – uzupełnij go w Słownikach.",
        )
    audit(db, request, "checklist_created", user=ctx.user, entity_type="employee", entity_id=e.id,
          details={"number": format_number(e.number), "kind": kind})  # fmt: skip
    db.commit()
    return _items(db, e, ctx.user)


class ItemPatch(BaseModel):
    done: bool | None = None
    skipped: bool | None = None
    note: str | None = Field(default=None, max_length=500)


@router.patch("/checklist-items/{item_id}", response_model=ItemOut)
def update_item(item_id: int, body: ItemPatch, ctx: WorkAuth, request: Request, db: DbSession) -> ItemOut:
    it = db.get(ChecklistItem, item_id)
    if it is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pozycji.")
    e = get_visible(db, ctx.user, it.employee_id)
    if not _can_edit(ctx.user, it):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Tę pozycję odhacza dział HR.")
    if body.done is not None:
        it.done_at = datetime.now(UTC) if body.done else None
        it.done_by_name = ctx.user.full_name if body.done else None
        if body.done:
            it.skipped = False
    if body.skipped is not None:
        it.skipped = body.skipped
        if body.skipped:
            it.done_at, it.done_by_name = None, None
    if "note" in body.model_fields_set:
        it.note = (body.note or "").strip() or None
    audit(db, request, "checklist_item_updated", user=ctx.user, entity_type="employee", entity_id=e.id,
          details={"number": format_number(e.number), "item": it.label, "done": it.done_at is not None,
                   "skipped": it.skipped})  # fmt: skip
    db.commit()
    db.refresh(it)
    return _item_out(db, it, e, ctx.user)


# ---------- zadania (otwarte pozycje wszystkich osób) ----------


class TaskOut(ItemOut):
    employee_id: int
    employee: str
    number: str
    department: str | None


def open_tasks(db: Session, user: User, mine: bool = False) -> list[TaskOut]:
    q = (
        select(ChecklistItem, Employee)
        .join(Employee, Employee.id == ChecklistItem.employee_id)
        .where(ChecklistItem.done_at.is_(None), ChecklistItem.skipped.is_(False))
    )
    if mine and user.role == Role.manager:
        q = q.where(ChecklistItem.responsible == "manager")
    elif mine:
        q = q.where(ChecklistItem.responsible == "hr")
    out = []
    for it, e in db.execute(apply_scope(q, user)).unique().all():
        base = _item_out(db, it, e, user)
        if base.state not in lifecycle.OPEN_STATES:
            continue
        out.append(
            TaskOut(
                **base.model_dump(),
                employee_id=e.id,
                employee=f"{e.last_name} {e.first_name}",
                number=format_number(e.number),
                department=e.department.name if e.department else None,
            )
        )
    return sorted(out, key=lambda t: (t.due_date or date.max, t.employee, t.id))


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(ctx: WorkAuth, db: DbSession, mine: bool = False) -> list[TaskOut]:
    return open_tasks(db, ctx.user, mine)


# ---------- szablony ----------


class TemplateItemIn(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    responsible: Literal["hr", "manager"] = "hr"
    due_days: int = Field(default=0, ge=-365, le=365)
    auto: str | None = Field(default=None, max_length=40)


class TemplateItemOut(TemplateItemIn):
    id: int


class AutoOption(BaseModel):
    value: str
    label: str


class TemplatesOut(BaseModel):
    onboarding: list[TemplateItemOut]
    offboarding: list[TemplateItemOut]
    auto_options: list[AutoOption]


def _templates(db: Session) -> TemplatesOut:
    out = TemplatesOut(onboarding=[], offboarding=[], auto_options=[])
    for t in db.scalars(
        select(ChecklistTemplateItem)
        .where(ChecklistTemplateItem.is_active)
        .order_by(ChecklistTemplateItem.sort, ChecklistTemplateItem.id)
    ):
        getattr(out, t.kind).append(
            TemplateItemOut(
                id=t.id, label=t.label, responsible=t.responsible, due_days=t.due_days, auto=t.auto
            )
        )
    out.auto_options = [
        AutoOption(value="photo", label="Zdjęcie w kartotece"),
        AutoOption(value="card", label="Wydrukowana karta"),
        *[
            AutoOption(value=f"training:{t.id}", label=f"Szkolenie: {t.name}")
            for t in db.scalars(select(TrainingType).order_by(TrainingType.name))
        ],
        *[
            AutoOption(value=f"document:{t.id}", label=f"Dokument: {t.name}")
            for t in db.scalars(select(DocumentTemplate).order_by(DocumentTemplate.name))
        ],
    ]
    return out


@router.get("/checklist-templates", response_model=TemplatesOut)
def get_templates(ctx: WorkAuth, db: DbSession) -> TemplatesOut:
    return _templates(db)


class TemplateListIn(BaseModel):
    items: list[TemplateItemIn] = Field(default_factory=list, max_length=60)


@router.put("/checklist-templates/{kind}", response_model=TemplatesOut)
def set_templates(
    kind: Kind, body: TemplateListIn, ctx: StaffAuth, request: Request, db: DbSession
) -> TemplatesOut:
    valid_auto = {o.value for o in _templates(db).auto_options}
    for it in body.items:
        if it.auto and it.auto not in valid_auto:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail=f"Nieznany warunek automatyczny: {it.auto}"
            )
    # stare pozycje wyłączamy (checklisty pracowników są kopiami, więc nic się w nich nie zmienia)
    for t in db.scalars(select(ChecklistTemplateItem).where(ChecklistTemplateItem.kind == kind)):
        t.is_active = False
    for i, it in enumerate(body.items):
        db.add(ChecklistTemplateItem(kind=kind, sort=i, **{**it.model_dump(), "label": it.label.strip()}))
    audit(db, request, "checklist_template_updated", user=ctx.user, entity_type="checklist",
          details={"kind": kind, "items": [it.label for it in body.items]})  # fmt: skip
    db.commit()
    return _templates(db)
