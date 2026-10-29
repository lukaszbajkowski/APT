"""Komunikaty kadr do grupy pracowników (agencja / wydział): push i e-mail w języku odbiorcy,
treść w aplikacji pracownika i potwierdzenie przeczytania."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import crypto, i18n, mailer, push, translate
from app.audit import audit
from app.db import SessionLocal
from app.deps import Auth, DbSession, StaffAuth, utcnow
from app.emails import Email
from app.models import Broadcast, BroadcastRecipient, Employee, EmployeeStatus, Role, User

router = APIRouter(prefix="/api/broadcasts", tags=["broadcasts"])
me_router = APIRouter(prefix="/api/me/broadcasts", tags=["me"])


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
def create(
    body: BroadcastIn, ctx: StaffAuth, request: Request, db: DbSession, tasks: BackgroundTasks
) -> BroadcastOut:
    if body.kind == "info" and len(body.body) > 2000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Komunikat może mieć do 2000 znaków.")
    emps = _recipients(db, body)
    if not emps:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="W tej grupie nie ma aktywnych pracowników.")
    b = Broadcast(
        kind=body.kind,
        subject=body.subject.strip(),
        body=body.body.strip(),
        agency_id=body.agency_id,
        department_id=body.department_id,
        created_by_name=ctx.user.full_name,
        recipients=[BroadcastRecipient(employee_id=e.id) for e in emps],
    )
    db.add(b)
    db.flush()
    audit(
        db,
        request,
        "broadcast_sent",
        user=ctx.user,
        entity_type="broadcast",
        entity_id=b.id,
        details={"recipients": len(emps), "agency_id": body.agency_id, "department_id": body.department_id},
    )
    db.commit()
    db.refresh(b)
    tasks.add_task(_deliver, b.id)
    return _out(db, b)


@router.get("", response_model=list[BroadcastOut])
def list_all(ctx: StaffAuth, db: DbSession) -> list[BroadcastOut]:
    return [_out(db, b) for b in db.scalars(select(Broadcast).order_by(Broadcast.id.desc()).limit(100))]


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
        .where(BroadcastRecipient.employee_id == eid)
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
        .where(BroadcastRecipient.employee_id == eid, BroadcastRecipient.read_at.is_(None))
    )
    return {"unread": n or 0}


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
