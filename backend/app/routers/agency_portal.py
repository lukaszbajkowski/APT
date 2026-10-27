"""Agencja pracy: badania lekarskie pracowników i zgłoszenia nowych osób (zatwierdzane przez kadry)."""

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app import crypto, storage
from app.audit import audit
from app.config import get_settings
from app.deps import AuthContext, DbSession, StaffAuth, require_roles
from app.models import Agency, EmployeeRequest, MedicalExam, Role
from app.pesel import PeselError, normalize, parse
from app.routers.employees import EmployeeIn, create_employee, format_number, get_visible

router = APIRouter(prefix="/api", tags=["agency"])
ExamView = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager, Role.agency))]
ExamEdit = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.agency))]
RequestAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.agency))]
AgencyOnly = Annotated[AuthContext, Depends(require_roles(Role.agency))]

KINDS = {"wstepne": "wstępne", "okresowe": "okresowe", "kontrolne": "kontrolne"}
MAX_MB = 15
ALLOWED = {
    b"%PDF": ("pdf", "application/pdf"),
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
    b"\x89PNG": ("png", "image/png"),
}


# ---------- badania lekarskie ----------


class ExamOut(BaseModel):
    id: int
    kind: str
    kind_label: str
    exam_date: date
    valid_until: date | None
    state: str  # valid | expiring | expired | none
    has_file: bool
    original_name: str | None
    notes: str | None
    created_by_name: str | None
    created_at: datetime
    can_delete: bool


EXPIRING_DAYS = 30


def exam_state(valid_until: date | None, today: date | None = None) -> str:
    today = today or date.today()
    if valid_until is None:
        return "none"
    if valid_until < today:
        return "expired"
    if (valid_until - today).days <= EXPIRING_DAYS:
        return "expiring"
    return "valid"


def _exam_out(x: MedicalExam, user: Any) -> ExamOut:
    return ExamOut(
        id=x.id,
        kind=x.kind,
        kind_label=KINDS.get(x.kind, x.kind),
        exam_date=x.exam_date,
        valid_until=x.valid_until,
        state=exam_state(x.valid_until),
        has_file=bool(x.file_name),
        original_name=x.original_name,
        notes=x.notes,
        created_by_name=x.created_by_name,
        created_at=x.created_at,
        can_delete=user.role in (Role.admin, Role.hr)
        or (user.role == Role.agency and x.created_by_name == user.full_name),
    )


def _dir(employee_id: int) -> Path:
    p = Path(get_settings().data_dir) / "medical" / str(employee_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


@router.get("/employees/{employee_id}/medical-exams", response_model=list[ExamOut])
def list_exams(employee_id: int, ctx: ExamView, db: DbSession) -> list[ExamOut]:
    e = get_visible(db, ctx.user, employee_id)
    q = select(MedicalExam).where(MedicalExam.employee_id == e.id).order_by(MedicalExam.exam_date.desc())
    return [_exam_out(x, ctx.user) for x in db.scalars(q)]


@router.post("/employees/{employee_id}/medical-exams", response_model=ExamOut, status_code=201)
async def add_exam(
    employee_id: int,
    ctx: ExamEdit,
    request: Request,
    db: DbSession,
    kind: Annotated[Literal["wstepne", "okresowe", "kontrolne"], Form()],
    exam_date: Annotated[date, Form()],
    valid_until: Annotated[date | None, Form()] = None,
    notes: Annotated[str | None, Form(max_length=500)] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> ExamOut:
    e = get_visible(db, ctx.user, employee_id)
    if exam_date > date.today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Data badania nie może być z przyszłości.")
    if valid_until is not None and valid_until < exam_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ważne do – nie wcześniej niż data badania.")
    data, kind_file = None, None
    if file is not None and file.filename:
        data = await file.read(MAX_MB * 1024 * 1024 + 1)
        if len(data) > MAX_MB * 1024 * 1024:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"Plik za duży (max {MAX_MB} MB)."
            )
        kind_file = next((v for k, v in ALLOWED.items() if data.startswith(k)), None)
        if kind_file is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Dozwolone pliki: PDF, JPG, PNG.")
    x = MedicalExam(
        employee_id=e.id,
        kind=kind,
        exam_date=exam_date,
        valid_until=valid_until,
        notes=(notes or "").strip() or None,
        original_name=(file.filename or "")[:255] if data else None,
        created_by_name=ctx.user.full_name,
    )
    db.add(x)
    db.flush()
    if data and kind_file:
        x.file_name = f"{x.id}.{kind_file[0]}"
        storage.write(_dir(e.id) / x.file_name, data)
    audit(
        db,
        request,
        "medical_exam_added",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "kind": kind,
            "exam_date": exam_date.isoformat(),
            "valid_until": valid_until.isoformat() if valid_until else None,
            "file": bool(data),
        },
    )
    db.commit()
    db.refresh(x)
    return _exam_out(x, ctx.user)


def _exam(db: DbSession, ctx: AuthContext, exam_id: int) -> tuple[MedicalExam, Any]:
    x = db.get(MedicalExam, exam_id)
    if x is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiego badania.")
    return x, get_visible(db, ctx.user, x.employee_id)


@router.get("/medical-exams/{exam_id}/file")
def exam_file(exam_id: int, ctx: ExamView, request: Request, db: DbSession) -> Response:
    x, e = _exam(db, ctx, exam_id)
    if not x.file_name or not (_dir(e.id) / x.file_name).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku.")
    ext = x.file_name.rsplit(".", 1)[-1]
    media = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}[ext]
    audit(
        db,
        request,
        "medical_exam_viewed",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "exam_id": x.id},
    )
    db.commit()
    return Response(
        storage.read(_dir(e.id) / x.file_name),
        media_type=media,
        headers={
            "Content-Disposition": f'inline; filename="badanie_{x.id}.{ext}"',
            "Cache-Control": "no-store",
        },
    )


@router.delete("/medical-exams/{exam_id}", status_code=204)
def delete_exam(exam_id: int, ctx: ExamEdit, request: Request, db: DbSession) -> Response:
    x, e = _exam(db, ctx, exam_id)
    if not _exam_out(x, ctx.user).can_delete:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Możesz usunąć tylko badanie dodane przez siebie."
        )
    path = _dir(e.id) / x.file_name if x.file_name else None
    audit(
        db,
        request,
        "medical_exam_deleted",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "kind": x.kind, "exam_date": x.exam_date.isoformat()},
    )
    db.delete(x)
    db.commit()
    if path:
        path.unlink(missing_ok=True)
    return Response(status_code=204)


# ---------- zgłoszenia nowych osób ----------


class RequestIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    pesel: str | None = None
    country_id: int | None = None
    department_id: int | None = None
    position_id: int | None = None
    hire_date: date | None = None
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("first_name", "last_name", "pesel", "notes", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return (v.strip() or None) if isinstance(v, str) else v


class Ref(BaseModel):
    id: int
    name: str


class RequestOut(BaseModel):
    id: int
    agency: Ref
    first_name: str
    last_name: str
    pesel: str | None  # pełny tylko dla kadr; agencja widzi końcówkę
    birth_date: date | None
    country_id: int | None
    department_id: int | None
    position_id: int | None
    hire_date: date | None
    notes: str | None
    status: str
    created_by_name: str | None
    created_at: datetime
    decided_by_name: str | None
    decided_at: datetime | None
    reject_reason: str | None
    employee_id: int | None


def _req_out(r: EmployeeRequest, user: Any) -> RequestOut:
    pesel = crypto.decrypt(r.pesel_enc) if r.pesel_enc else None
    birth = None
    if pesel:
        try:
            birth = parse(pesel).birth_date
        except PeselError:
            birth = None
    if pesel and user.role not in (Role.admin, Role.hr):
        pesel = "•" * 9 + pesel[-2:]
    return RequestOut(
        id=r.id,
        agency=Ref(id=r.agency.id, name=r.agency.name),
        first_name=r.first_name,
        last_name=r.last_name,
        pesel=pesel,
        birth_date=birth if user.role in (Role.admin, Role.hr) else None,
        country_id=r.country_id,
        department_id=r.department_id,
        position_id=r.position_id,
        hire_date=r.hire_date,
        notes=r.notes,
        status=r.status,
        created_by_name=r.created_by_name,
        created_at=r.created_at,
        decided_by_name=r.decided_by_name,
        decided_at=r.decided_at,
        reject_reason=r.reject_reason,
        employee_id=r.employee_id,
    )


@router.post("/employee-requests", response_model=RequestOut, status_code=201)
def create_request(body: RequestIn, ctx: AgencyOnly, request: Request, db: DbSession) -> RequestOut:
    ag = db.get(Agency, ctx.user.agency_id) if ctx.user.agency_id else None
    if ag is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Konto agencji nie ma przypisanej APT.")
    enc = None
    if body.pesel:
        pesel = normalize(body.pesel)
        try:
            parse(pesel)
        except PeselError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"PESEL: {exc}") from exc
        enc = crypto.encrypt(pesel)
    r = EmployeeRequest(
        agency_id=ag.id,
        first_name=body.first_name,
        last_name=body.last_name,
        pesel_enc=enc,
        country_id=body.country_id,
        department_id=body.department_id,
        position_id=body.position_id,
        hire_date=body.hire_date,
        notes=body.notes,
        status="pending",
        created_by_name=ctx.user.full_name,
    )
    db.add(r)
    db.flush()
    audit(
        db,
        request,
        "employee_request_created",
        user=ctx.user,
        entity_type="employee_request",
        entity_id=r.id,
        details={"agency": ag.name, "name": f"{r.last_name} {r.first_name}"},
    )
    db.commit()
    db.refresh(r)
    _notify_hr(db, r)
    return _req_out(r, ctx.user)


def _notify_hr(db: DbSession, r: EmployeeRequest) -> None:
    from app import mailer
    from app.emails import Email
    from app.models import User

    mail = Email(
        subject=f"Nowe zgłoszenie od agencji: {r.last_name} {r.first_name}",
        title="Zgłoszenie nowej osoby",
        paragraphs=[
            f"Agencja „{r.agency.name}” zgłosiła nową osobę. Sprawdź dane i zatwierdź albo odrzuć zgłoszenie."
        ],
        details=[("Osoba", f"{r.last_name} {r.first_name}"), ("APT", r.agency.name)],
        button=("Otwórz zgłoszenia", mailer.link("/zgloszenia")),
    )
    for u in db.scalars(select(User).where(User.role == Role.hr, User.is_active)):
        mailer.send(u.email, mail)


@router.get("/employee-requests", response_model=list[RequestOut])
def list_requests(ctx: RequestAuth, db: DbSession) -> list[RequestOut]:
    q = select(EmployeeRequest).order_by(EmployeeRequest.created_at.desc())
    if ctx.user.role == Role.agency:
        q = q.where(EmployeeRequest.agency_id == ctx.user.agency_id)
    return [_req_out(r, ctx.user) for r in db.scalars(q).unique()]


def _pending(db: DbSession, request_id: int) -> EmployeeRequest:
    r = db.get(EmployeeRequest, request_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiego zgłoszenia.")
    if r.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Zgłoszenie zostało już rozpatrzone.")
    return r


class ApproveIn(BaseModel):
    # kadry mogą poprawić dane przed zatwierdzeniem
    first_name: str | None = None
    last_name: str | None = None
    pesel: str | None = None
    country_id: int | None = None
    department_id: int | None = None
    position_id: int | None = None
    hire_date: date | None = None
    confirm_duplicate: bool = False


@router.post("/employee-requests/{request_id}/approve", response_model=RequestOut)
def approve_request(
    request_id: int, body: ApproveIn, ctx: StaffAuth, request: Request, db: DbSession
) -> RequestOut:
    r = _pending(db, request_id)
    pesel = crypto.decrypt(r.pesel_enc) if r.pesel_enc else None
    fields = body.model_fields_set
    emp = EmployeeIn(
        first_name=body.first_name if "first_name" in fields and body.first_name else r.first_name,
        last_name=body.last_name if "last_name" in fields and body.last_name else r.last_name,
        pesel=body.pesel if "pesel" in fields else pesel,
        country_id=body.country_id if "country_id" in fields else r.country_id,
        agency_id=r.agency_id,
        department_id=body.department_id if "department_id" in fields else r.department_id,
        position_id=body.position_id if "position_id" in fields else r.position_id,
        hire_date=body.hire_date if "hire_date" in fields else r.hire_date,
        notes=r.notes,
        confirm_duplicate=body.confirm_duplicate,
    )
    out = create_employee(
        emp, ctx, request, db
    )  # te same kontrole co przy ręcznym dodaniu (PESEL, duplikaty)
    r = db.get(EmployeeRequest, request_id)
    r.status, r.employee_id = "approved", out.id
    r.decided_by_name, r.decided_at = ctx.user.full_name, datetime.now(UTC)
    r.pesel_enc = None  # PESEL jest już w kartotece
    audit(
        db,
        request,
        "employee_request_approved",
        user=ctx.user,
        entity_type="employee",
        entity_id=out.id,
        details={"request_id": r.id, "agency": r.agency.name, "number": out.number_display},
    )
    db.commit()
    db.refresh(r)
    return _req_out(r, ctx.user)


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/employee-requests/{request_id}/reject", response_model=RequestOut)
def reject_request(
    request_id: int, body: RejectIn, ctx: StaffAuth, request: Request, db: DbSession
) -> RequestOut:
    r = _pending(db, request_id)
    r.status, r.reject_reason = "rejected", body.reason.strip()
    r.decided_by_name, r.decided_at = ctx.user.full_name, datetime.now(UTC)
    r.pesel_enc = None  # odrzucone – nie przechowujemy PESEL
    audit(
        db,
        request,
        "employee_request_rejected",
        user=ctx.user,
        entity_type="employee_request",
        entity_id=r.id,
        details={"agency": r.agency.name, "name": f"{r.last_name} {r.first_name}", "reason": r.reject_reason},
    )
    db.commit()
    db.refresh(r)
    return _req_out(r, ctx.user)
