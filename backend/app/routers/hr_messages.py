"""„Napisz do kadr”: wątki pracownika z kadrami (w aplikacji, bez załączników).

Pracownik zakłada wątek (temat z listy) i dopisuje wiadomości; kadry i administrator odpowiadają i
ustawiają status: new → in_progress → done. Nowa wiadomość pracownika otwiera zamknięty wątek ponownie.
Kadry mogą też same zacząć rozmowę z pracownikiem, który ma aktywne konto (własny temat, status „w toku”).
"""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app import mailer
from app.audit import audit
from app.deps import Auth, DbSession, StaffAuth, utcnow
from app.emails import Email
from app.models import Employee, HrMessage, HrThread, Role
from app.routers.employees import format_number

SUBJECTS = [
    "Dane osobowe (poprawka)",
    "Zatrudnienie i stanowisko",
    "Karta identyfikacyjna",
    "Szkolenia",
    "Dokumenty do podpisu",
    "Dostęp do konta",
    "Inne",
]
Status = Literal["new", "in_progress", "done"]
ARCHIVE_DAYS = 30  # zakończona rozmowa bez ruchu tyle dni trafia do archiwum sama
AUTO_CLOSE_DAYS = 3  # rozmowa „w toku”, w której po odpowiedzi kadr pracownik milczy, zamyka się sama
MAX_OPEN = 10
MAX_PER_HOUR = 10

me_router = APIRouter(prefix="/api/me/messages", tags=["me"])
staff_router = APIRouter(prefix="/api/hr-messages", tags=["hr-messages"])


class MessageOut(BaseModel):
    id: int
    from_staff: bool
    kind: Literal["message", "status"] = "message"
    author_name: str | None = None
    body: str
    created_at: datetime


class ThreadOut(BaseModel):
    id: int
    subject: str
    status: Status
    created_at: datetime
    updated_at: datetime
    messages: list[MessageOut]
    employee_id: int | None = None
    employee_name: str | None = None
    employee_number: str | None = None
    archived: bool = False


class ThreadRow(BaseModel):
    id: int
    subject: str
    status: Status
    updated_at: datetime
    last_from_staff: bool
    preview: str
    unread: bool = False
    archived: bool = False
    employee_id: int | None = None
    employee_name: str | None = None
    employee_number: str | None = None


def _archived(t: HrThread, staff: bool) -> bool:
    return (t.staff_archived_at if staff else t.employee_archived_at) is not None


def _out(t: HrThread, staff: bool) -> ThreadOut:
    return ThreadOut(
        id=t.id,
        archived=_archived(t, staff),
        subject=t.subject,
        status=t.status,  # type: ignore[arg-type]
        created_at=t.created_at,
        updated_at=t.updated_at,
        messages=[
            MessageOut(
                id=m.id,
                from_staff=m.from_staff,
                kind=m.kind,  # type: ignore[arg-type]
                author_name=m.author.full_name if staff and m.kind == "status" and m.author else None,
                body=m.body,
                created_at=m.created_at,
            )
            for m in t.messages
        ],
        employee_id=t.employee_id if staff else None,
        employee_name=f"{t.employee.last_name} {t.employee.first_name}" if staff else None,
        employee_number=format_number(t.employee.number) if staff else None,
    )


def close_stale(db: DbSession) -> int:
    """Zamyka rozmowy, w których po odpowiedzi kadr pracownik milczy od AUTO_CLOSE_DAYS dni."""
    cutoff = utcnow() - timedelta(days=AUTO_CLOSE_DAYS)
    closed = 0
    for t in db.scalars(
        select(HrThread).where(HrThread.status == "in_progress", HrThread.updated_at < cutoff)
    ).unique():
        last = _last(t)
        if not last.from_staff or last.created_at >= cutoff:
            continue
        t.status = "done"
        t.messages.append(HrMessage(kind="status", from_staff=True, body="done_auto"))
        audit(
            db,
            None,
            "hr_thread_auto_closed",
            username="system",
            entity_type="employee",
            entity_id=t.employee_id,
            details={"thread": t.id, "days": AUTO_CLOSE_DAYS},
        )
        closed += 1
    if closed:
        db.commit()
    return closed


def auto_archive(db: DbSession) -> int:
    """Zakończone rozmowy bez ruchu od ARCHIVE_DAYS dni trafiają do archiwum obu stron."""
    cutoff = utcnow() - timedelta(days=ARCHIVE_DAYS)
    now = utcnow()
    n = 0
    for t in db.scalars(
        select(HrThread).where(
            HrThread.status == "done",
            HrThread.updated_at < cutoff,
            or_(HrThread.staff_archived_at.is_(None), HrThread.employee_archived_at.is_(None)),
        )
    ).unique():
        t.staff_archived_at = t.staff_archived_at or now
        t.employee_archived_at = t.employee_archived_at or now
        audit(
            db,
            None,
            "hr_thread_auto_archived",
            username="system",
            entity_type="employee",
            entity_id=t.employee_id,
            details={"thread": t.id, "days": ARCHIVE_DAYS},
        )
        n += 1
    if n:
        db.commit()
    return n


def _archive(db: DbSession, t: HrThread, staff: bool, on: bool, ctx, request: Request) -> None:
    if on and t.status != "done":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Archiwizować można tylko zakończone rozmowy."
        )
    setattr(t, "staff_archived_at" if staff else "employee_archived_at", utcnow() if on else None)
    audit(
        db,
        request,
        "hr_thread_archived" if on else "hr_thread_unarchived",
        user=ctx.user,
        entity_type="employee",
        entity_id=t.employee_id,
        details={"thread": t.id, "side": "kadry" if staff else "pracownik"},
    )
    db.commit()


def _last(t: HrThread) -> HrMessage:
    """Ostatnia prawdziwa wiadomość (bez zdarzeń zmiany statusu)."""
    return next(m for m in reversed(t.messages) if m.kind == "message")


def _change_status(t: HrThread, new: str, user, staff: bool) -> None:
    if t.status != new:
        t.status = new
        if new != "done":  # wznowiona rozmowa wraca do skrzynek obu stron
            t.staff_archived_at = t.employee_archived_at = None
        t.messages.append(HrMessage(kind="status", from_staff=staff, author_id=user.id, body=new))


def _unread(t: HrThread, staff: bool) -> bool:
    """Ostatnia wiadomość jest od drugiej strony i nie była jeszcze otwarta."""
    last = _last(t)
    seen = t.staff_seen_at if staff else t.employee_seen_at
    return last.from_staff != staff and (seen is None or seen < last.created_at)


def _row(t: HrThread, staff: bool) -> ThreadRow:
    last = _last(t)
    return ThreadRow(
        id=t.id,
        subject=t.subject,
        status=t.status,  # type: ignore[arg-type]
        updated_at=t.updated_at,
        last_from_staff=last.from_staff,
        preview=last.body[:120],
        unread=_unread(t, staff),
        archived=_archived(t, staff),
        employee_id=t.employee_id if staff else None,
        employee_name=f"{t.employee.last_name} {t.employee.first_name}" if staff else None,
        employee_number=format_number(t.employee.number) if staff else None,
    )


def _employee_id(ctx: Auth) -> int:
    if ctx.user.role != Role.employee or ctx.user.employee_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    return ctx.user.employee_id


def _own_thread(db: DbSession, employee_id: int, thread_id: int) -> HrThread:
    t = db.get(HrThread, thread_id)
    if t is None or t.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono wiadomości.")
    return t


# --- pracownik ----------------------------------------------------------------------------


@me_router.get("/subjects", response_model=list[str])
def subjects(ctx: Auth) -> list[str]:
    _employee_id(ctx)
    return SUBJECTS


@me_router.get("/count")
def my_count(ctx: Auth, db: DbSession) -> dict[str, int]:
    eid = _employee_id(ctx)
    close_stale(db)
    rows = db.scalars(
        select(HrThread).where(HrThread.employee_id == eid, HrThread.employee_archived_at.is_(None))
    ).unique()
    return {"unread": sum(1 for t in rows if _unread(t, False))}


@me_router.get("", response_model=list[ThreadRow])
def my_threads(ctx: Auth, db: DbSession, archived: bool = False) -> list[ThreadRow]:
    eid = _employee_id(ctx)
    close_stale(db)
    col = HrThread.employee_archived_at
    rows = db.scalars(
        select(HrThread)
        .where(HrThread.employee_id == eid, col.is_not(None) if archived else col.is_(None))
        .order_by(HrThread.updated_at.desc())
    ).unique()
    return [_row(t, False) for t in rows]


@me_router.get("/{thread_id}", response_model=ThreadOut)
def my_thread(thread_id: int, ctx: Auth, db: DbSession) -> ThreadOut:
    t = _own_thread(db, _employee_id(ctx), thread_id)
    if _unread(t, False):
        t.employee_seen_at = utcnow()
        db.commit()
    return _out(t, False)


@me_router.post("/{thread_id}/archive", response_model=ThreadOut)
def my_archive(thread_id: int, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    t = _own_thread(db, _employee_id(ctx), thread_id)
    _archive(db, t, False, True, ctx, request)
    return _out(t, False)


@me_router.post("/{thread_id}/unarchive", response_model=ThreadOut)
def my_unarchive(thread_id: int, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    t = _own_thread(db, _employee_id(ctx), thread_id)
    _archive(db, t, False, False, ctx, request)
    return _out(t, False)


class NewThreadIn(BaseModel):
    subject: str = Field(max_length=80)
    body: str = Field(min_length=1, max_length=2000)


class BodyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


def _check_rate(db: DbSession, eid: int) -> None:
    sent = db.scalar(
        select(func.count())
        .select_from(HrMessage)
        .join(HrThread, HrThread.id == HrMessage.thread_id)
        .where(
            HrThread.employee_id == eid,
            HrMessage.from_staff.is_(False),
            HrMessage.kind == "message",
            HrMessage.created_at > utcnow() - timedelta(hours=1),
        )
    )
    if (sent or 0) >= MAX_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Za dużo wiadomości. Spróbuj za godzinę."
        )


@me_router.post("", response_model=ThreadOut, status_code=status.HTTP_201_CREATED)
def create_thread(body: NewThreadIn, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    eid = _employee_id(ctx)
    if body.subject not in SUBJECTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wybierz temat z listy.")
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz treść wiadomości.")
    _check_rate(db, eid)
    open_count = db.scalar(
        select(func.count())
        .select_from(HrThread)
        .where(HrThread.employee_id == eid, HrThread.status != "done")
    )
    if (open_count or 0) >= MAX_OPEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Masz za dużo otwartych spraw. Poczekaj na odpowiedź kadr."
        )
    now = utcnow()
    t = HrThread(employee_id=eid, subject=body.subject, status="new", created_at=now, updated_at=now)
    t.messages.append(HrMessage(from_staff=False, author_id=ctx.user.id, body=text, created_at=now))
    db.add(t)
    db.flush()
    audit(
        db,
        request,
        "hr_thread_created",
        user=ctx.user,
        entity_type="employee",
        entity_id=eid,
        details={"thread": t.id, "subject": t.subject},
    )
    db.commit()
    db.refresh(t)
    _push_staff(db)
    return _out(t, False)


@me_router.post("/{thread_id}/messages", response_model=ThreadOut)
def my_reply(thread_id: int, body: BodyIn, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    eid = _employee_id(ctx)
    t = _own_thread(db, eid, thread_id)
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz treść wiadomości.")
    _check_rate(db, eid)
    now = utcnow()
    t.messages.append(HrMessage(from_staff=False, author_id=ctx.user.id, body=text, created_at=now))
    if t.status == "done":
        _change_status(t, "new", ctx.user, False)
    t.updated_at = now
    audit(
        db,
        request,
        "hr_message_sent",
        user=ctx.user,
        entity_type="employee",
        entity_id=eid,
        details={"thread": t.id},
    )
    db.commit()
    db.refresh(t)
    _push_staff(db)
    return _out(t, False)


# --- kadry --------------------------------------------------------------------------------


@staff_router.get("/count")
def new_count(ctx: StaffAuth, db: DbSession) -> dict[str, int]:
    close_stale(db)
    n = db.scalar(select(func.count()).select_from(HrThread).where(HrThread.status == "new"))
    rows = db.scalars(
        select(HrThread).where(HrThread.status != "done", HrThread.staff_archived_at.is_(None))
    ).unique()
    return {"new": n or 0, "unread": sum(1 for t in rows if _unread(t, True))}


@staff_router.get("", response_model=list[ThreadRow])
def staff_threads(
    ctx: StaffAuth,
    db: DbSession,
    status_filter: Status | None = None,
    q: str | None = None,
    archived: bool = False,
) -> list[ThreadRow]:
    close_stale(db)
    col = HrThread.staff_archived_at
    stmt = (
        select(HrThread)
        .join(Employee, Employee.id == HrThread.employee_id)
        .where(col.is_not(None) if archived else col.is_(None))
    )
    if status_filter:
        stmt = stmt.where(HrThread.status == status_filter)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Employee.last_name.ilike(like), Employee.first_name.ilike(like), HrThread.subject.ilike(like))
        )
    rows = db.scalars(stmt.order_by(HrThread.updated_at.desc()).limit(300)).unique()
    return [_row(t, True) for t in rows]


def _thread(db: DbSession, thread_id: int) -> HrThread:
    t = db.get(HrThread, thread_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono wątku.")
    return t


@staff_router.get("/{thread_id}", response_model=ThreadOut)
def staff_thread(thread_id: int, ctx: StaffAuth, db: DbSession) -> ThreadOut:
    t = _thread(db, thread_id)
    if _unread(t, True):
        t.staff_seen_at = utcnow()
        db.commit()
    return _out(t, True)


@staff_router.post("/{thread_id}/messages", response_model=ThreadOut)
def staff_reply(thread_id: int, body: BodyIn, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    t = _thread(db, thread_id)
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz treść odpowiedzi.")
    now = utcnow()
    t.messages.append(HrMessage(from_staff=True, author_id=ctx.user.id, body=text, created_at=now))
    if t.status in ("new", "done"):  # odpowiedź kadr otwiera także zamkniętą rozmowę
        _change_status(t, "in_progress", ctx.user, True)
    t.updated_at = now
    audit(
        db,
        request,
        "hr_message_replied",
        user=ctx.user,
        entity_type="employee",
        entity_id=t.employee_id,
        details={"thread": t.id},
    )
    db.commit()
    _notify_employee(t)
    db.refresh(t)
    return _out(t, True)


@staff_router.post("/{thread_id}/archive", response_model=ThreadOut)
def staff_archive(thread_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    t = _thread(db, thread_id)
    _archive(db, t, True, True, ctx, request)
    return _out(t, True)


@staff_router.post("/{thread_id}/unarchive", response_model=ThreadOut)
def staff_unarchive(thread_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    t = _thread(db, thread_id)
    _archive(db, t, True, False, ctx, request)
    return _out(t, True)


class StatusIn(BaseModel):
    status: Status


@staff_router.post("/{thread_id}/status", response_model=ThreadOut)
def set_status(thread_id: int, body: StatusIn, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    t = _thread(db, thread_id)
    _change_status(t, body.status, ctx.user, True)
    t.updated_at = utcnow()
    audit(
        db,
        request,
        "hr_thread_status",
        user=ctx.user,
        entity_type="employee",
        entity_id=t.employee_id,
        details={"thread": t.id, "status": body.status},
    )
    db.commit()
    db.refresh(t)
    return _out(t, True)


class StaffNewIn(BaseModel):
    employee_id: int
    subject: str = Field(min_length=3, max_length=80)
    body: str = Field(min_length=1, max_length=2000)


MAX_STAFF_PER_HOUR = 30


@staff_router.post("", response_model=ThreadOut, status_code=status.HTTP_201_CREATED)
def staff_start(body: StaffNewIn, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    """Kadry zaczynają rozmowę z pracownikiem, który ma aktywne konto (inaczej jej nie przeczyta)."""
    from app.routers.passkeys import employee_account

    e = db.get(Employee, body.employee_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
    if employee_account(db, e.id) is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ten pracownik nie ma aktywnego konta w aplikacji, więc nie przeczyta wiadomości.",
        )
    subject, text = body.subject.strip(), body.body.strip()
    if len(subject) < 3 or not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz temat i treść wiadomości.")
    sent = db.scalar(
        select(func.count())
        .select_from(HrThread)
        .join(HrMessage, HrMessage.thread_id == HrThread.id)
        .where(
            HrMessage.author_id == ctx.user.id,
            HrMessage.kind == "message",
            HrMessage.created_at > utcnow() - timedelta(hours=1),
        )
    )
    if (sent or 0) >= MAX_STAFF_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Za dużo wiadomości. Spróbuj za godzinę."
        )
    now = utcnow()
    t = HrThread(
        employee_id=e.id,
        subject=subject,
        status="in_progress",
        created_at=now,
        updated_at=now,
        staff_seen_at=now,
    )
    t.messages.append(HrMessage(from_staff=True, author_id=ctx.user.id, body=text, created_at=now))
    db.add(t)
    db.flush()
    audit(
        db,
        request,
        "hr_thread_started_by_staff",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"thread": t.id, "subject": subject, "number": format_number(e.number)},
    )
    db.commit()
    _notify_employee(t, started=True)
    db.refresh(t)
    return _out(t, True)


def _push_staff(db: DbSession) -> None:
    """Powiadomienie push dla kadr i administratorów (ogólne, bez nazwiska i treści)."""
    from app import push
    from app.models import Role, User

    ids = list(db.scalars(select(User.id).where(User.role.in_([Role.admin, Role.hr]), User.is_active)))
    push.notify_users(db, ids, "Nowa wiadomość od pracownika", "Sprawdź skrzynkę w aplikacji.", "/wiadomosci")


def _notify_employee(t: HrThread, started: bool = False) -> None:
    """Krótka wiadomość bez treści odpowiedzi – na potwierdzony e-mail pracownika (jeśli jest)."""
    from app import crypto, i18n, push
    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as pdb:
        acct = pdb.scalar(select(User).where(User.employee_id == t.employee_id, User.is_active))
        lang = acct.language if acct else None
        if acct:
            push.notify_users(
                pdb,
                [acct.id],
                i18n.t(pdb, "Wiadomość od kadr" if started else "Odpowiedź od kadr", lang),
                i18n.t(
                    pdb,
                    "Kadry napisały do Ciebie." if started else "Kadry odpowiedziały na Twoją wiadomość.",
                    lang,
                ),
                "/moje-konto/wiadomosci",
            )
        e = t.employee
        if (
            not e.email_enc
            or e.email_verified_at is None
            or not (mailer.enabled() or mailer.outbox is not None)
        ):
            return
        try:
            to = crypto.decrypt_contact(e.email_enc)
            raw = Email(
                subject=(
                    "Kadry napisały do Ciebie – Identyfikacja pracowników APT"
                    if started
                    else "Kadry odpowiedziały na Twoją wiadomość – Identyfikacja pracowników APT"
                ),
                title="Nowa wiadomość od kadr" if started else "Nowa odpowiedź od kadr",
                greeting="Dzień dobry {first_name},",
                paragraphs=[
                    "kadry napisały do Ciebie w aplikacji. Zaloguj się, aby przeczytać."
                    if started
                    else "kadry odpowiedziały w sprawie „{subject}”. Zaloguj się, aby przeczytać."
                ],
            )
            mailer.send(to, i18n.tr_email(pdb, raw, lang, first_name=e.first_name, subject=t.subject))
        except Exception:  # noqa: BLE001 – powiadomienie nie może blokować odpowiedzi
            pass
