"""Komunikaty kadr do grupy pracowników (agencja / wydział): push i e-mail w języku odbiorcy,
treść w aplikacji pracownika i potwierdzenie przeczytania."""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import crypto, i18n, mailer, push, storage, translate
from app.audit import audit
from app.config import get_settings
from app.db import SessionLocal
from app.deps import Auth, DbSession, StaffAuth, utcnow
from app.emails import Email
from app.models import Broadcast, BroadcastFile, BroadcastRecipient, Employee, EmployeeStatus, Role, User

router = APIRouter(prefix="/api/broadcasts", tags=["broadcasts"])
me_router = APIRouter(prefix="/api/me/broadcasts", tags=["me"])


MAX_FILES = 5
MAX_MB = 15
ALLOWED = {
    b"%PDF": ("pdf", "application/pdf"),
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
    b"\x89PNG": ("png", "image/png"),
}
ARCHIVE_AFTER_ALL_READ = timedelta(days=2)  # po przeczytaniu przez wszystkich
ARCHIVE_AFTER_SENT = timedelta(days=7)  # gdy nie wszyscy przeczytali


def _dir(broadcast_id: int) -> Path:
    p = Path(get_settings().data_dir) / "broadcasts" / str(broadcast_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


class FileOut(BaseModel):
    id: int
    name: str
    size: int


def _files(b: Broadcast) -> list[FileOut]:
    return [FileOut(id=f.id, name=f.original_name, size=f.size) for f in b.files]


class TargetIn(BaseModel):
    agency_id: int | None = None
    department_id: int | None = None
    everyone: bool = False


class BroadcastIn(TargetIn):
    kind: Literal["info", "document"] = "info"
    subject: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=20000)


def _recipients(db, t: TargetIn) -> list[Employee]:
    if not (t.agency_id or t.department_id or t.everyone):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Wybierz agencję lub wydział albo zaznacz „wszyscy”."
        )
    q = select(Employee).where(Employee.status == EmployeeStatus.active)
    if t.agency_id:
        q = q.where(Employee.agency_id == t.agency_id)
    if t.department_id:
        q = q.where(Employee.department_id == t.department_id)
    return list(db.scalars(q).unique())


def _accounts(db, employees: list[Employee]) -> dict[int, User]:
    ids = [e.id for e in employees]
    if not ids:
        return {}
    return {
        u.employee_id: u
        for u in db.scalars(
            select(User).where(User.role == Role.employee, User.is_active, User.employee_id.in_(ids))
        ).unique()
    }


class PreviewOut(BaseModel):
    total: int
    with_account: int
    with_email: int
    unreachable: int


@router.post("/preview", response_model=PreviewOut)
def preview(body: TargetIn, ctx: StaffAuth, db: DbSession) -> PreviewOut:
    emps = _recipients(db, body)
    acc = _accounts(db, emps)
    mail = [e for e in emps if e.email_enc and e.email_verified_at is not None]
    reach = {e.id for e in emps if e.id in acc or (e.email_enc and e.email_verified_at is not None)}
    return PreviewOut(
        total=len(emps), with_account=len(acc), with_email=len(mail), unreachable=len(emps) - len(reach)
    )


class BroadcastOut(BaseModel):
    id: int
    kind: str
    subject: str
    body: str
    target: str
    created_by_name: str | None
    created_at: datetime
    total: int
    read: int
    files: list[FileOut]
    archived: bool


def _out(db, b: Broadcast) -> BroadcastOut:
    from app.models import Agency, Department

    parts = []
    if b.agency_id:
        a = db.get(Agency, b.agency_id)
        parts.append(a.name if a else "agencja")
    if b.department_id:
        d = db.get(Department, b.department_id)
        parts.append(d.name if d else "wydział")
    total = db.scalar(
        select(func.count()).select_from(BroadcastRecipient).where(BroadcastRecipient.broadcast_id == b.id)
    )
    read = db.scalar(
        select(func.count())
        .select_from(BroadcastRecipient)
        .where(BroadcastRecipient.broadcast_id == b.id, BroadcastRecipient.read_at.is_not(None))
    )
    return BroadcastOut(
        id=b.id,
        kind=b.kind,
        subject=b.subject,
        body=b.body,
        target=" · ".join(parts) or "wszyscy",
        created_by_name=b.created_by_name,
        created_at=b.created_at,
        total=total or 0,
        read=read or 0,
        files=_files(b),
        archived=b.archived_at is not None,
    )


def _deliver(broadcast_id: int) -> None:
    """Push i e-mail do odbiorców, każdy w swoim języku (tłumaczenia są w pamięci podręcznej)."""
    with SessionLocal() as db:
        b = db.get(Broadcast, broadcast_id)
        if b is None:
            return
        emps = list(
            db.scalars(
                select(Employee).where(
                    Employee.id.in_(
                        select(BroadcastRecipient.employee_id).where(BroadcastRecipient.broadcast_id == b.id)
                    )
                )
            ).unique()
        )
        accounts = _accounts(db, emps)
        for e in emps:
            acct = accounts.get(e.id)
            lang = acct.language if acct else None
            try:
                tr = {}
                if lang and i18n.valid_lang(lang) and translate.enabled():
                    tr = i18n.translate_many(db, [b.subject, b.body], lang)
                subject = tr.get(b.subject, b.subject)
                body = tr.get(b.body, b.body)
                if acct is not None:
                    push.notify_users(db, [acct.id], subject, body[:180], "/moje-konto/komunikaty")
                if e.email_enc and e.email_verified_at is not None:
                    from dataclasses import replace

                    from app import notify

                    # stałe teksty (powitanie, przycisk, stopka) tłumaczy tr_email; temat i treść są już
                    # przetłumaczone, więc podstawiamy je po tym kroku (bez .format na tekście kadr)
                    raw = Email(
                        subject="Identyfikacja pracowników APT",
                        title="Komunikat od kadr",
                        greeting="Dzień dobry {first_name},",
                        button=("Otwórz w aplikacji", notify._for("/moje-konto/komunikaty", acct)),
                        footer_note="Potwierdź przeczytanie w aplikacji.",
                    )
                    em = i18n.tr_email(db, raw, lang, first_name=e.first_name)
                    em = replace(em, subject=f"{subject} – {em.subject}", title=subject, paragraphs=[body])
                    mailer.send(crypto.decrypt_contact(e.email_enc), em)
            except Exception:  # noqa: BLE001 – błąd jednego odbiorcy nie zatrzymuje reszty
                continue


@router.post("", response_model=BroadcastOut, status_code=201)
async def create(
    ctx: StaffAuth,
    request: Request,
    db: DbSession,
    tasks: BackgroundTasks,
    subject: Annotated[str, Form(min_length=1, max_length=120)],
    body: Annotated[str, Form(min_length=1, max_length=20000)],
    kind: Annotated[Literal["info", "document"], Form()] = "info",
    agency_id: Annotated[int | None, Form()] = None,
    department_id: Annotated[int | None, Form()] = None,
    everyone: Annotated[bool, Form()] = False,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> BroadcastOut:
    if kind == "info" and len(body) > 2000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Komunikat może mieć do 2000 znaków.")
    emps = _recipients(db, TargetIn(agency_id=agency_id, department_id=department_id, everyone=everyone))
    if not emps:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="W tej grupie nie ma aktywnych pracowników.")
    uploads = [f for f in (files or []) if f.filename]
    if len(uploads) > MAX_FILES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Najwyżej {MAX_FILES} załączników.")
    blobs: list[tuple[str, str, str, bytes]] = []
    for f in uploads:
        data = await f.read(MAX_MB * 1024 * 1024 + 1)
        if len(data) > MAX_MB * 1024 * 1024:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"Plik za duży (max {MAX_MB} MB)."
            )
        kind_file = next((v for k, v in ALLOWED.items() if data.startswith(k)), None)
        if kind_file is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Dozwolone pliki: PDF, JPG, PNG.")
        blobs.append(((f.filename or "plik")[:255], kind_file[0], kind_file[1], data))
    b = Broadcast(
        kind=kind,
        subject=subject.strip(),
        body=body.strip(),
        agency_id=agency_id,
        department_id=department_id,
        created_by_name=ctx.user.full_name,
        recipients=[BroadcastRecipient(employee_id=e.id) for e in emps],
    )
    db.add(b)
    db.flush()
    for name, ext, ctype, data in blobs:
        bf = BroadcastFile(
            broadcast_id=b.id, file_name="tmp", original_name=name, content_type=ctype, size=len(data)
        )
        db.add(bf)
        db.flush()
        bf.file_name = f"{bf.id}.{ext}"
        storage.write(_dir(b.id) / bf.file_name, data)
    audit(
        db,
        request,
        "broadcast_sent",
        user=ctx.user,
        entity_type="broadcast",
        entity_id=b.id,
        details={
            "recipients": len(emps),
            "agency_id": agency_id,
            "department_id": department_id,
            "files": len(blobs),
        },
    )
    db.commit()
    db.refresh(b)
    tasks.add_task(_deliver, b.id)
    return _out(db, b)


@router.get("", response_model=list[BroadcastOut])
def list_all(ctx: StaffAuth, db: DbSession, archived: bool = False) -> list[BroadcastOut]:
    cond = Broadcast.archived_at.is_not(None) if archived else Broadcast.archived_at.is_(None)
    return [
        _out(db, b)
        for b in db.scalars(select(Broadcast).where(cond).order_by(Broadcast.id.desc()).limit(100))
    ]


@router.get("/files/{file_id}")
def staff_file(file_id: int, ctx: StaffAuth, db: DbSession) -> Response:
    return _send_file(db, file_id)


def _send_file(db, file_id: int, employee_id: int | None = None) -> Response:
    f = db.get(BroadcastFile, file_id)
    if f is None or (
        employee_id is not None and db.get(BroadcastRecipient, (f.broadcast_id, employee_id)) is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pliku.")
    path = _dir(f.broadcast_id) / f.file_name
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku.")
    safe = f.original_name.replace('"', "").replace("\n", " ").replace("\r", " ")
    return Response(
        storage.read(path),
        media_type=f.content_type,
        headers={"Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "no-store"},
    )


def archive_due(db, now=None) -> int:
    """Archiwizuje komunikaty: 2 dni po przeczytaniu przez wszystkich albo 7 dni po wysłaniu."""
    now = now or utcnow()
    n = 0
    for b in db.scalars(select(Broadcast).where(Broadcast.archived_at.is_(None))):
        unread, last = db.execute(
            select(
                func.count().filter(BroadcastRecipient.read_at.is_(None)),
                func.max(BroadcastRecipient.read_at),
            ).where(BroadcastRecipient.broadcast_id == b.id)
        ).one()
        if (unread == 0 and last is not None and now - last >= ARCHIVE_AFTER_ALL_READ) or (
            now - b.created_at >= ARCHIVE_AFTER_SENT
        ):
            b.archived_at = now
            n += 1
    db.commit()
    return n


class RecipientOut(BaseModel):
    employee_id: int
    name: str
    read_at: datetime | None


@router.get("/{broadcast_id}/recipients", response_model=list[RecipientOut])
def recipients(broadcast_id: int, ctx: StaffAuth, db: DbSession) -> list[RecipientOut]:
    if db.get(Broadcast, broadcast_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono komunikatu.")
    rows = db.execute(
        select(BroadcastRecipient, Employee)
        .join(Employee, Employee.id == BroadcastRecipient.employee_id)
        .where(BroadcastRecipient.broadcast_id == broadcast_id)
        .order_by(BroadcastRecipient.read_at.is_(None).desc(), Employee.last_name, Employee.first_name)
    ).all()
    return [
        RecipientOut(employee_id=e.id, name=f"{e.last_name} {e.first_name}", read_at=r.read_at)
        for r, e in rows
    ]


@router.post("/{broadcast_id}/remind")
def remind(broadcast_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> dict[str, int]:
    """Przypomnienie (push) tym, którzy jeszcze nie potwierdzili; w języku każdego."""
    b = db.get(Broadcast, broadcast_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono komunikatu.")
    ids = list(
        db.scalars(
            select(BroadcastRecipient.employee_id).where(
                BroadcastRecipient.broadcast_id == b.id, BroadcastRecipient.read_at.is_(None)
            )
        )
    )
    emps = list(db.scalars(select(Employee).where(Employee.id.in_(ids))).unique()) if ids else []
    sent = 0
    for acct in _accounts(db, emps).values():
        lang = acct.language
        title = i18n.t(db, "Przypomnienie: potwierdź przeczytanie", lang)
        try:
            sent += (
                push.notify_users(db, [acct.id], title, i18n.t(db, b.subject, lang), "/moje-konto/komunikaty")
                > 0
            )
        except Exception:  # noqa: BLE001
            continue
    audit(
        db,
        request,
        "broadcast_reminded",
        user=ctx.user,
        entity_type="broadcast",
        entity_id=b.id,
        details={"unread": len(ids), "pushed": sent},
    )
    db.commit()
    return {"unread": len(ids), "pushed": sent}


# ---------- strona pracownika ----------


class MyBroadcast(BaseModel):
    id: int
    kind: str
    files: list[FileOut]
    subject: str
    body: str
    sent_at: datetime
    read_at: datetime | None


def _my_employee_id(ctx) -> int:
    if ctx.user.role != Role.employee or ctx.user.employee_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    return ctx.user.employee_id


@me_router.get("", response_model=list[MyBroadcast])
def my_list(ctx: Auth, db: DbSession) -> list[MyBroadcast]:
    eid = _my_employee_id(ctx)
    rows = db.execute(
        select(BroadcastRecipient, Broadcast)
        .join(Broadcast, Broadcast.id == BroadcastRecipient.broadcast_id)
        .where(BroadcastRecipient.employee_id == eid, Broadcast.archived_at.is_(None))
        .order_by(Broadcast.id.desc())
        .limit(50)
    ).all()
    lang = ctx.user.language
    texts = [x for _, b in rows for x in (b.subject, b.body)]
    tr: dict[str, str] = {}
    if lang and i18n.valid_lang(lang) and translate.enabled() and texts:
        try:
            tr = i18n.translate_many(db, texts, lang)
            db.commit()
        except Exception:  # noqa: BLE001
            tr = {}
    return [
        MyBroadcast(
            id=b.id,
            kind=b.kind,
            files=_files(b),
            subject=tr.get(b.subject, b.subject),
            body=tr.get(b.body, b.body),
            sent_at=b.created_at,
            read_at=r.read_at,
        )
        for r, b in rows
    ]


@me_router.get("/count")
def my_count(ctx: Auth, db: DbSession) -> dict[str, int]:
    eid = _my_employee_id(ctx)
    n = db.scalar(
        select(func.count())
        .select_from(BroadcastRecipient)
        .join(Broadcast, Broadcast.id == BroadcastRecipient.broadcast_id)
        .where(
            BroadcastRecipient.employee_id == eid,
            BroadcastRecipient.read_at.is_(None),
            Broadcast.archived_at.is_(None),
        )
    )
    return {"unread": n or 0}


@me_router.get("/files/{file_id}")
def my_file(file_id: int, ctx: Auth, db: DbSession) -> Response:
    return _send_file(db, file_id, _my_employee_id(ctx))


@me_router.post("/{broadcast_id}/read", status_code=204)
def my_read(broadcast_id: int, ctx: Auth, request: Request, db: DbSession) -> None:
    eid = _my_employee_id(ctx)
    r = db.get(BroadcastRecipient, (broadcast_id, eid))
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono komunikatu.")
    if r.read_at is None:
        r.read_at = utcnow()
        audit(db, request, "broadcast_read", user=ctx.user, entity_type="broadcast", entity_id=broadcast_id)
        db.commit()
