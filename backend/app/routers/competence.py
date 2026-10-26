"""Wymagane szkolenia na stanowiskach i matryca kompetencji."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import competence as comp
from app.audit import audit
from app.deps import AuthContext, DbSession, require_roles
from app.models import (
    Department,
    Employee,
    EmployeeStatus,
    Position,
    PositionRequirement,
    Role,
    TrainingProgram,
    TrainingProgramMentor,
    TrainingType,
)
from app.routers.employees import apply_scope, format_number, get_visible

router = APIRouter(prefix="/api", tags=["competence"])
# każdy poza kontem agencji
AnyAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager, Role.viewer))]
EditAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr))]
ListAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]

MAX_MATRIX = 400


# ---------- wymagania stanowisk ----------


class ReqItem(BaseModel):
    type_id: int
    program_id: int | None = None


class ReqOut(ReqItem):
    id: int
    label: str
    type_name: str


class PositionReqOut(BaseModel):
    position_id: int
    position: str
    department: str | None
    is_active: bool
    requirements: list[ReqOut]


class ReqsIn(BaseModel):
    items: list[ReqItem] = Field(default_factory=list, max_length=100)


def _req_out(r: PositionRequirement) -> ReqOut:
    return ReqOut(
        id=r.id,
        type_id=r.type_id,
        program_id=r.program_id,
        label=comp.requirement_label(r),
        type_name=r.type.name,
    )


def _position_out(db: Session, p: Position, reqs: list[PositionRequirement]) -> PositionReqOut:
    dep = db.get(Department, p.department_id) if p.department_id else None
    return PositionReqOut(
        position_id=p.id,
        position=p.name,
        department=dep.name if dep else None,
        is_active=p.is_active,
        requirements=[_req_out(r) for r in sorted(reqs, key=comp.requirement_label)],
    )


@router.get("/position-requirements", response_model=list[PositionReqOut])
def list_requirements(ctx: ListAuth, db: DbSession) -> list[PositionReqOut]:
    by_pos = comp.requirements_by_position(db)
    positions = db.scalars(select(Position).order_by(Position.name))
    return [_position_out(db, p, by_pos.get(p.id, [])) for p in positions if p.is_active or by_pos.get(p.id)]


@router.put("/positions/{position_id}/requirements", response_model=PositionReqOut)
def set_requirements(
    position_id: int, body: ReqsIn, ctx: EditAuth, request: Request, db: DbSession
) -> PositionReqOut:
    p = db.get(Position, position_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono stanowiska.")
    wanted: set[tuple[int, int | None]] = set()
    for it in body.items:
        t = db.get(TrainingType, it.type_id)
        if t is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiego rodzaju szkolenia.")
        if it.program_id is not None:
            prog = db.get(TrainingProgram, it.program_id)
            if prog is None or prog.type_id != t.id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiej pozycji w katalogu.")
        wanted.add((it.type_id, it.program_id))
    current = list(
        db.scalars(select(PositionRequirement).where(PositionRequirement.position_id == p.id)).unique()
    )
    for r in current:
        if (r.type_id, r.program_id) not in wanted:
            db.delete(r)
    have = {(r.type_id, r.program_id) for r in current}
    for type_id, program_id in wanted - have:
        db.add(PositionRequirement(position_id=p.id, type_id=type_id, program_id=program_id))
    db.flush()
    reqs = list(
        db.scalars(select(PositionRequirement).where(PositionRequirement.position_id == p.id)).unique()
    )
    audit(
        db,
        request,
        "position_requirements_set",
        user=ctx.user,
        entity_type="position",
        entity_id=p.id,
        details={"position": p.name, "requirements": [comp.requirement_label(r) for r in reqs]},
    )
    db.commit()
    return _position_out(db, p, reqs)


class EmployeeReqOut(BaseModel):
    label: str
    state: str
    valid_until: date | None


@router.get("/employees/{employee_id}/requirements", response_model=list[EmployeeReqOut])
def employee_requirements(employee_id: int, ctx: AnyAuth, db: DbSession) -> list[EmployeeReqOut]:
    e = get_visible(db, ctx.user, employee_id)
    trs = comp.trainings_by_employee(db, [e.id])
    return [
        EmployeeReqOut(**x)
        for x in comp.employee_requirements(e, trs[e.id], comp.requirements_by_position(db))
    ]


# ---------- matryca ----------


class Column(BaseModel):
    key: str
    label: str
    group: str  # nazwa rodzaju
    type_id: int
    program_id: int | None


class Cell(BaseModel):
    state: str
    required: bool
    mentor: bool
    valid_until: date | None


class MatrixRow(BaseModel):
    employee_id: int
    number: str
    name: str
    department: str | None
    position: str | None
    cells: dict[str, Cell]
    problems: int


class MatrixOut(BaseModel):
    columns: list[Column]
    rows: list[MatrixRow]
    truncated: bool


def _key(type_id: int, program_id: int | None) -> str:
    return f"p{program_id}" if program_id else f"t{type_id}"


@router.get("/trainings/matrix", response_model=MatrixOut)
def matrix(
    ctx: ListAuth,
    db: DbSession,
    department_id: int | None = None,
    position_id: int | None = None,
    general: bool = False,
) -> MatrixOut:
    q = select(Employee).where(Employee.status == EmployeeStatus.active)
    if department_id:
        q = q.where(Employee.department_id == department_id)
    if position_id:
        q = q.where(Employee.position_id == position_id)
    q = apply_scope(q, ctx.user).order_by(Employee.last_name, Employee.first_name).limit(MAX_MATRIX + 1)
    emps = list(db.scalars(q).unique())
    truncated = len(emps) > MAX_MATRIX
    emps = emps[:MAX_MATRIX]

    reqs = comp.requirements_by_position(db)
    types = {t.id: t for t in db.scalars(select(TrainingType))}
    programs = [
        p for p in db.scalars(select(TrainingProgram).order_by(TrainingProgram.name)).unique() if p.is_active
    ]

    # kolumny: katalog wydziału + to, co wymagane u pokazanych osób (+ zwykłe rodzaje)
    cols: dict[str, Column] = {}

    def add(type_id: int, program: TrainingProgram | None) -> None:
        k = _key(type_id, program.id if program else None)
        if k not in cols and type_id in types:
            label = (
                program.name
                + (
                    f" · {program.department.name}"
                    if program and program.department and not department_id
                    else ""
                )
                if program
                else types[type_id].name
            )
            cols[k] = Column(key=k, label=label, group=types[type_id].name, type_id=type_id,
                             program_id=program.id if program else None)  # fmt: skip

    for p in programs:
        if department_id is None or p.department_id in (None, department_id):
            add(p.type_id, p)
    for e in emps:
        for r in reqs.get(e.position_id or -1, []):
            add(r.type_id, r.program)
    if general:
        for t in sorted(types.values(), key=lambda t: t.name):
            if t.kind == "general" and t.is_active:
                add(t.id, None)
    columns = sorted(cols.values(), key=lambda c: (c.group, c.label.lower()))

    mentors: set[tuple[int, int]] = {
        (m.employee_id, m.program_id) for m in db.scalars(select(TrainingProgramMentor))
    }
    trs = comp.trainings_by_employee(db, [e.id for e in emps])
    today = date.today()
    rows = []
    for e in emps:
        required = {_key(r.type_id, r.program_id) for r in reqs.get(e.position_id or -1, [])}
        cells: dict[str, Cell] = {}
        problems = 0
        for c in columns:
            prog_name = (
                next((p.name for p in programs if p.id == c.program_id), None) if c.program_id else None
            )
            st, tr = comp.best_state(trs[e.id], c.type_id, c.program_id, prog_name, today)
            req = c.key in required
            if req and st in comp.PROBLEM:
                problems += 1
            cells[c.key] = Cell(
                state=st,
                required=req,
                mentor=c.program_id is not None and (e.id, c.program_id) in mentors,
                valid_until=tr.valid_until if tr else None,
            )
        rows.append(
            MatrixRow(
                employee_id=e.id,
                number=format_number(e.number),
                name=f"{e.last_name} {e.first_name}",
                department=e.department.name if e.department else None,
                position=e.position.name if e.position else None,
                cells=cells,
                problems=problems,
            )
        )
    return MatrixOut(columns=columns, rows=rows, truncated=truncated)
