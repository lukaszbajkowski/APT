"""Szkolenia i uprawnienia pracowników oraz słownik ich rodzajów."""

import calendar
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import templating
from app.audit import audit
from app.config import get_settings
from app.deps import AuthContext, DbSession, get_auth, require_roles
from app.models import (
    Department,
    DocumentTemplate,
    Employee,
    EmployeeStatus,
    Role,
    Training,
    TrainingProgram,
    TrainingType,
    User,
)
from app.routers.employees import apply_scope, format_number, get_visible
from app.templating import FieldDef, TemplateError

router = APIRouter(prefix="/api", tags=["trainings"])

AnyAuth = Annotated[AuthContext, Depends(get_auth)]
EditAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr))]
ListAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]

WARN_DAYS = 30
MAX_SCAN = 10 * 1024 * 1024
SCAN_TYPES = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
_MAGIC = {"pdf": b"%PDF", "jpg": b"\xff\xd8\xff", "png": b"\x89PNG"}


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def status_of(valid_until: date | None, today: date | None = None) -> str:
    today = today or date.today()
    if valid_until is None:
        return "none"
    if valid_until < today:
        return "expired"
    if valid_until <= today + timedelta(days=WARN_DAYS):
        return "expiring"
    return "valid"


def training_status(tr: Training, today: date | None = None) -> str:
    """Status: dla stanowiskowych najpierw etap (zaplanowane / w trakcie / po czasie), potem ważność."""
    today = today or date.today()
    if tr.type.kind == "position" and tr.start_date and not (tr.end_date and tr.end_date <= today):
        if tr.start_date > today:
            return "planned"
        if tr.standard_days is not None and (today - tr.start_date).days > tr.standard_days:
            return "overdue"
        return "in_progress"
    st = status_of(tr.valid_until, today)
    if st == "none" and tr.completed_on:
        return "completed"
    return st


def days_in_training(tr: Training, today: date | None = None) -> int | None:
    if tr.type.kind != "position" or not tr.start_date:
        return None
    end = tr.end_date if tr.end_date and tr.end_date <= (today or date.today()) else (today or date.today())
    return max(0, (end - tr.start_date).days)


# ---------- rodzaje ----------


class TrainingTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["general", "position"] = "general"
    validity_months: int | None = Field(default=None, ge=1, le=600)
    template_id: int | None = None
    is_active: bool = True


class ProgramIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    department_id: int | None = None
    standard_days: int | None = Field(default=None, ge=0, le=3650)
    is_active: bool = True


class ProgramOut(ProgramIn):
    id: int
    type_id: int
    department: str | None = None


class TrainingTypeOut(TrainingTypeIn):
    id: int
    template_name: str | None = None
    in_use: int = 0
    # pola formularza – z szablonu dokumentu (ustawiane w edytorze szablonu)
    fields: list[FieldDef] = Field(default_factory=list)
    programs: list[ProgramOut] = Field(default_factory=list)


def _program_out(p: TrainingProgram) -> ProgramOut:
    return ProgramOut(
        id=p.id,
        type_id=p.type_id,
        name=p.name,
        department_id=p.department_id,
        department=p.department.name if p.department else None,
        standard_days=p.standard_days,
        is_active=p.is_active,
    )


def type_fields(db: Session, t: TrainingType) -> list[FieldDef]:
    tpl = db.get(DocumentTemplate, t.template_id) if t.template_id else None
    return [FieldDef.model_validate(f) for f in tpl.fields] if tpl else []


def _type_out(db: Session, t: TrainingType) -> TrainingTypeOut:
    tpl = db.get(DocumentTemplate, t.template_id) if t.template_id else None
    used = len(db.scalars(select(Training.id).where(Training.type_id == t.id)).all())
    return TrainingTypeOut(
        id=t.id,
        name=t.name,
        kind=t.kind,  # type: ignore[arg-type]
        validity_months=t.validity_months,
        fields=type_fields(db, t),
        programs=[
            _program_out(p)
            for p in db.scalars(
                select(TrainingProgram).where(TrainingProgram.type_id == t.id).order_by(TrainingProgram.name)
            ).unique()
        ],
        template_id=t.template_id,
        template_name=tpl.name if tpl else None,
        is_active=t.is_active,
        in_use=used,
    )


def _check_template(db: Session, template_id: int | None) -> None:
    if template_id is not None and db.get(DocumentTemplate, template_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiego szablonu dokumentu.")


@router.get("/training-types", response_model=list[TrainingTypeOut])
def list_types(ctx: AnyAuth, db: DbSession) -> list[TrainingTypeOut]:
    types = db.scalars(select(TrainingType).order_by(TrainingType.name))
    return [_type_out(db, t) for t in types]


@router.post("/training-types", response_model=TrainingTypeOut, status_code=status.HTTP_201_CREATED)
def create_type(body: TrainingTypeIn, ctx: EditAuth, request: Request, db: DbSession) -> TrainingTypeOut:
    _check_template(db, body.template_id)
    t = TrainingType(**body.model_dump(), fields=[])
    t.name = t.name.strip()
    db.add(t)
    try:
        db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Rodzaj o tej nazwie już istnieje.") from exc
    audit(
        db,
        request,
        "training_type_created",
        user=ctx.user,
        entity_type="training_type",
        entity_id=t.id,
        details={"name": t.name},
    )
    db.commit()
    return _type_out(db, t)


@router.put("/training-types/{type_id}", response_model=TrainingTypeOut)
def update_type(
    type_id: int, body: TrainingTypeIn, ctx: EditAuth, request: Request, db: DbSession
) -> TrainingTypeOut:
    t = db.get(TrainingType, type_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono rodzaju szkolenia.")
    _check_template(db, body.template_id)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    t.name = t.name.strip()
    try:
        db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Rodzaj o tej nazwie już istnieje.") from exc
    audit(
        db,
        request,
        "training_type_updated",
        user=ctx.user,
        entity_type="training_type",
        entity_id=t.id,
        details={"name": t.name},
    )
    db.commit()
    return _type_out(db, t)


def _program_data(db: Session, body: ProgramIn) -> dict[str, Any]:
    if body.department_id is not None and db.get(Department, body.department_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiego wydziału.")
    return {**body.model_dump(), "name": body.name.strip()}


def _save_program(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Takie szkolenie (nazwa i wydział) jest już w katalogu."
        ) from exc


@router.post(
    "/training-types/{type_id}/programs", response_model=ProgramOut, status_code=status.HTTP_201_CREATED
)
def create_program(
    type_id: int, body: ProgramIn, ctx: EditAuth, request: Request, db: DbSession
) -> ProgramOut:
    t = db.get(TrainingType, type_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono rodzaju szkolenia.")
    p = TrainingProgram(type_id=t.id, **_program_data(db, body))
    db.add(p)
    _save_program(db)
    audit(
        db,
        request,
        "training_program_saved",
        user=ctx.user,
        entity_type="training_type",
        entity_id=t.id,
        details={"name": p.name},
    )
    db.commit()
    db.refresh(p)
    return _program_out(p)


@router.put("/training-programs/{program_id}", response_model=ProgramOut)
def update_program(
    program_id: int, body: ProgramIn, ctx: EditAuth, request: Request, db: DbSession
) -> ProgramOut:
    p = db.get(TrainingProgram, program_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pozycji katalogu.")
    for k, v in _program_data(db, body).items():
        setattr(p, k, v)
    _save_program(db)
    audit(
        db,
        request,
        "training_program_saved",
        user=ctx.user,
        entity_type="training_type",
        entity_id=p.type_id,
        details={"name": p.name},
    )
    db.commit()
    db.refresh(p)
    return _program_out(p)


@router.delete("/training-programs/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_program(program_id: int, ctx: EditAuth, request: Request, db: DbSession) -> None:
    p = db.get(TrainingProgram, program_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pozycji katalogu.")
    audit(
        db,
        request,
        "training_program_deleted",
        user=ctx.user,
        entity_type="training_type",
        entity_id=p.type_id,
        details={"name": p.name},
    )
    db.delete(p)  # wpisane szkolenia zachowują skopiowane dane (program_id → NULL)
    db.commit()


# ---------- szkolenia pracownika ----------


class TrainingIn(BaseModel):
    type_id: int
    program_id: int | None = None
    name: str | None = Field(default=None, max_length=200)
    department_id: int | None = None
    start_date: date | None = None
    exam_date: date | None = None
    end_date: date | None = None
    completed_on: date | None = None
    valid_until: date | None = None
    mentor_id: int | None = None
    standard_days: int | None = Field(default=None, ge=0, le=3650)
    values: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=2000)


class TrainingOut(BaseModel):
    id: int
    employee_id: int
    type_id: int
    type_name: str
    kind: str
    program_id: int | None
    name: str | None
    department_id: int | None
    department: str | None
    start_date: date | None
    exam_date: date | None
    end_date: date | None
    completed_on: date | None
    valid_until: date | None
    mentor_id: int | None
    mentor_name: str | None
    standard_days: int | None
    values: dict[str, Any]
    notes: str | None
    has_scan: bool
    scan_name: str | None
    status: str
    days: int | None  # dni nauki (stanowiskowe): od rozpoczęcia do zakończenia albo do dziś
    can_generate: bool
    created_by_name: str | None


def _out(db: Session, tr: Training) -> TrainingOut:
    tpl_id = tr.type.template_id
    tpl = db.get(DocumentTemplate, tpl_id) if tpl_id else None
    m = tr.mentor
    return TrainingOut(
        id=tr.id,
        employee_id=tr.employee_id,
        type_id=tr.type_id,
        type_name=tr.type.name,
        kind=tr.type.kind,
        program_id=tr.program_id,
        name=tr.name,
        department_id=tr.department_id,
        department=tr.department.name if tr.department else None,
        start_date=tr.start_date,
        exam_date=tr.exam_date,
        end_date=tr.end_date,
        completed_on=tr.completed_on,
        valid_until=tr.valid_until,
        mentor_id=tr.mentor_id,
        mentor_name=f"{m.last_name} {m.first_name}" if m else None,
        standard_days=tr.standard_days,
        values=tr.values or {},
        notes=tr.notes,
        has_scan=tr.scan_file is not None,
        scan_name=tr.scan_name,
        status=training_status(tr),
        days=days_in_training(tr),
        can_generate=bool(tpl and tpl.is_active),
        created_by_name=tr.created_by_name,
    )


def _apply(db: Session, tr: Training, body: TrainingIn) -> None:
    t = db.get(TrainingType, body.type_id)
    if t is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiego rodzaju szkolenia.")
    if not t.is_active and tr.type_id != t.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ten rodzaj szkolenia jest wyłączony.")
    fields = type_fields(db, t)
    try:
        templating.form_values(fields, body.values)  # tylko walidacja
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    values = {}
    for f in fields:
        v = body.values.get(f.key)
        if isinstance(v, str):
            v = v.strip()
        if v not in (None, ""):
            values[f.key] = v

    position = t.kind == "position"
    program = None
    if position and body.program_id is not None:
        program = db.get(TrainingProgram, body.program_id)
        if program is None or program.type_id != t.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiej pozycji w katalogu.")
    if position:
        dates = [d for d in (body.start_date, body.exam_date, body.end_date) if d]
        if dates != sorted(dates):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Daty muszą iść po kolei: rozpoczęcie ≤ egzamin ≤ zakończenie.",
            )
        if body.department_id is not None and db.get(Department, body.department_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiego wydziału.")
        if body.mentor_id is not None:
            if body.mentor_id == tr.employee_id:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, detail="Opiekunem nie może być sam pracownik."
                )
            if db.get(Employee, body.mentor_id) is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie ma takiego opiekuna.")

    completed = body.completed_on or (body.end_date if position else None)
    valid_until = body.valid_until
    if valid_until is None and t.validity_months and completed:
        valid_until = add_months(completed, t.validity_months)
    if valid_until and completed and valid_until < completed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="„Ważne do” nie może być przed datą ukończenia."
        )

    tr.type_id = t.id
    tr.type = t
    tr.program_id = program.id if program else None
    tr.name = ((body.name or "").strip() or None) if position else None
    tr.department_id = body.department_id if position else None
    tr.start_date = body.start_date if position else None
    tr.exam_date = body.exam_date if position else None
    tr.end_date = body.end_date if position else None
    tr.mentor_id = body.mentor_id if position else None
    tr.standard_days = body.standard_days if position else None
    tr.completed_on = completed
    tr.valid_until = valid_until
    tr.values = values
    tr.notes = (body.notes or "").strip() or None


def _get(db: Session, user: User, training_id: int) -> tuple[Training, Employee]:
    tr = db.get(Training, training_id)
    if tr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono szkolenia.")
    e = get_visible(db, user, tr.employee_id)
    return tr, e


def _details(e: Employee, tr: Training) -> dict[str, Any]:
    return {"number": format_number(e.number), "type": tr.type.name, "name": tr.name}


@router.get("/employees/{employee_id}/trainings", response_model=list[TrainingOut])
def list_trainings(employee_id: int, ctx: AnyAuth, db: DbSession) -> list[TrainingOut]:
    get_visible(db, ctx.user, employee_id)
    rows = db.scalars(
        select(Training)
        .where(Training.employee_id == employee_id)
        .order_by(Training.completed_on.desc().nulls_first(), Training.id.desc())
    ).unique()
    return [_out(db, tr) for tr in rows]


@router.post(
    "/employees/{employee_id}/trainings", response_model=TrainingOut, status_code=status.HTTP_201_CREATED
)
def create_training(
    employee_id: int, body: TrainingIn, ctx: EditAuth, request: Request, db: DbSession
) -> TrainingOut:
    e = get_visible(db, ctx.user, employee_id)
    tr = Training(employee_id=e.id, created_by_name=ctx.user.full_name)
    _apply(db, tr, body)
    db.add(tr)
    db.flush()
    audit(
        db,
        request,
        "training_created",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details=_details(e, tr),
    )
    db.commit()
    db.refresh(tr)
    return _out(db, tr)


@router.put("/trainings/{training_id}", response_model=TrainingOut)
def update_training(
    training_id: int, body: TrainingIn, ctx: EditAuth, request: Request, db: DbSession
) -> TrainingOut:
    tr, e = _get(db, ctx.user, training_id)
    _apply(db, tr, body)
    audit(
        db,
        request,
        "training_updated",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details=_details(e, tr),
    )
    db.commit()
    db.refresh(tr)
    return _out(db, tr)


def _scan_dir(employee_id: int) -> Path:
    p = Path(get_settings().data_dir) / "trainings" / str(employee_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _drop_scan(tr: Training) -> None:
    if tr.scan_file:
        (_scan_dir(tr.employee_id) / tr.scan_file).unlink(missing_ok=True)
    tr.scan_file = tr.scan_name = tr.scan_type = None


@router.delete("/trainings/{training_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_training(training_id: int, ctx: EditAuth, request: Request, db: DbSession) -> None:
    tr, e = _get(db, ctx.user, training_id)
    audit(
        db,
        request,
        "training_deleted",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details=_details(e, tr),
    )
    _drop_scan(tr)
    db.delete(tr)
    db.commit()


@router.post("/trainings/{training_id}/scan", response_model=TrainingOut)
async def upload_scan(
    training_id: int,
    ctx: EditAuth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> TrainingOut:
    tr, e = _get(db, ctx.user, training_id)
    data = await file.read(MAX_SCAN + 1)
    if len(data) > MAX_SCAN:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik jest za duży (max 10 MB).")
    ext = next((x for x, magic in _MAGIC.items() if data.startswith(magic)), None)
    if ext is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Dozwolone pliki: PDF, JPG, PNG.")
    _drop_scan(tr)
    name = f"{tr.id}_{uuid.uuid4().hex[:8]}.{ext}"
    (_scan_dir(tr.employee_id) / name).write_bytes(data)
    tr.scan_file = name
    tr.scan_name = (file.filename or f"zaswiadczenie.{ext}")[:255]
    tr.scan_type = {v: k for k, v in SCAN_TYPES.items()}[ext]
    audit(
        db,
        request,
        "training_scan_uploaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details=_details(e, tr),
    )
    db.commit()
    db.refresh(tr)
    return _out(db, tr)


@router.delete("/trainings/{training_id}/scan", response_model=TrainingOut)
def delete_scan(training_id: int, ctx: EditAuth, request: Request, db: DbSession) -> TrainingOut:
    tr, e = _get(db, ctx.user, training_id)
    _drop_scan(tr)
    audit(
        db,
        request,
        "training_scan_deleted",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details=_details(e, tr),
    )
    db.commit()
    db.refresh(tr)
    return _out(db, tr)


@router.get("/trainings/{training_id}/scan")
def get_scan(training_id: int, ctx: AnyAuth, db: DbSession, download: bool = False) -> Response:
    tr, _ = _get(db, ctx.user, training_id)
    if not tr.scan_file:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak skanu zaświadczenia.")
    path = _scan_dir(tr.employee_id) / tr.scan_file
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Plik skanu nie istnieje na serwerze.")
    fname = templating.safe_filename(tr.scan_name or tr.scan_file)
    disp = "attachment" if download else "inline"
    return Response(
        path.read_bytes(),
        media_type=tr.scan_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"{disp}; filename*=UTF-8''{fname}",
            "Cache-Control": "no-store",
        },
    )


@router.post("/trainings/{training_id}/document", status_code=status.HTTP_201_CREATED)
def generate_document(training_id: int, ctx: EditAuth, request: Request, db: DbSession) -> Any:
    from app.routers import documents

    tr, e = _get(db, ctx.user, training_id)
    if not tr.type.template_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Ten rodzaj szkolenia nie ma szablonu dokumentu."
        )
    t = documents._usable_template(db, ctx.user, tr.type.template_id)
    try:
        g = documents._create_document(db, request, ctx.user, e, t, tr.values or {}, training=tr)
    except TemplateError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"{exc} Uzupełnij te pola w szkoleniu albo zmień szablon.",
        ) from exc
    db.commit()
    db.refresh(g.doc)
    out = documents._doc_out(g.doc, t, ctx.user)
    out.pdf_error = g.pdf_error
    return out


# ---------- kończące się ----------


class ExpiringOut(BaseModel):
    training_id: int
    employee_id: int
    number: str
    last_name: str
    first_name: str
    department: str | None
    type_name: str
    name: str | None
    valid_until: date
    status: str


def expiring(db: Session, user: User, days: int = WARN_DAYS) -> list[ExpiringOut]:
    """Najnowsze szkolenie danego rodzaju u aktywnych pracowników, którego ważność mija w ciągu `days` dni."""
    today = date.today()
    q = (
        select(Training, Employee)
        .join(Employee, Employee.id == Training.employee_id)
        .where(Employee.status == EmployeeStatus.active, Training.valid_until.is_not(None))
    )
    q = apply_scope(q, user)
    latest: dict[tuple[int, int, str | None], tuple[Training, Employee]] = {}
    for tr, e in db.execute(q).unique().all():
        key = (e.id, tr.type_id, tr.name)
        cur = latest.get(key)
        if cur is None or (tr.valid_until or date.min) > (cur[0].valid_until or date.min):
            latest[key] = (tr, e)
    out = []
    for tr, e in latest.values():
        if tr.valid_until and tr.valid_until <= today + timedelta(days=days):
            out.append(
                ExpiringOut(
                    training_id=tr.id,
                    employee_id=e.id,
                    number=format_number(e.number),
                    last_name=e.last_name,
                    first_name=e.first_name,
                    department=e.department.name if e.department else None,
                    type_name=tr.type.name,
                    name=tr.name,
                    valid_until=tr.valid_until,
                    status=status_of(tr.valid_until, today),
                )
            )
    return sorted(out, key=lambda x: (x.valid_until, x.last_name))


@router.get("/trainings/expiring", response_model=list[ExpiringOut])
def list_expiring(ctx: ListAuth, db: DbSession, days: int = WARN_DAYS) -> list[ExpiringOut]:
    return expiring(db, ctx.user, max(0, min(days, 365)))


class InProgressOut(BaseModel):
    training_id: int
    employee_id: int
    number: str
    last_name: str
    first_name: str
    name: str | None
    type_name: str
    department: str | None
    mentor_name: str | None
    start_date: date
    exam_date: date | None
    standard_days: int | None
    days: int
    status: str


@router.get("/trainings/in-progress", response_model=list[InProgressOut])
def list_in_progress(ctx: ListAuth, db: DbSession) -> list[InProgressOut]:
    """Szkolenia stanowiskowe rozpoczęte (lub zaplanowane), jeszcze nie zakończone – aktywni pracownicy."""
    today = date.today()
    q = (
        select(Training, Employee)
        .join(Employee, Employee.id == Training.employee_id)
        .join(TrainingType, TrainingType.id == Training.type_id)
        .where(
            Employee.status == EmployeeStatus.active,
            TrainingType.kind == "position",
            Training.start_date.is_not(None),
        )
    )
    out = []
    for tr, e in db.execute(apply_scope(q, ctx.user)).unique().all():
        st = training_status(tr, today)
        if st not in ("planned", "in_progress", "overdue"):
            continue
        m = tr.mentor
        out.append(
            InProgressOut(
                training_id=tr.id,
                employee_id=e.id,
                number=format_number(e.number),
                last_name=e.last_name,
                first_name=e.first_name,
                name=tr.name,
                type_name=tr.type.name,
                department=tr.department.name if tr.department else None,
                mentor_name=f"{m.last_name} {m.first_name}" if m else None,
                start_date=tr.start_date,
                exam_date=tr.exam_date,
                standard_days=tr.standard_days,
                days=days_in_training(tr, today) or 0,
                status=st,
            )
        )
    order = {"overdue": 0, "in_progress": 1, "planned": 2}
    return sorted(out, key=lambda x: (order[x.status], x.start_date, x.last_name))
