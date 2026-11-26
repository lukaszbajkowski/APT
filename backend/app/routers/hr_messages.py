"""„Napisz do kadr”: wątki pracownika z kadrami (w aplikacji, bez załączników).

Pracownik zakłada wątek (temat z listy) i dopisuje wiadomości; kadry i administrator odpowiadają i
ustawiają status: new → in_progress → done. Nowa wiadomość pracownika otwiera zamknięty wątek ponownie.
Kadry mogą też same zacząć rozmowę z pracownikiem, który ma aktywne konto (własny temat, status „w toku”).
"""

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app import mailer, message_files
from app.audit import audit
from app.deps import Auth, DbSession, StaffAuth, utcnow
from app.emails import Email
from app.models import Employee, HrMessage, HrMessageFile, HrThread, HrThreadMember, Role
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
MAX_RECIPIENTS = 50  # wysyłka do kilku osób (osobno albo wspólna rozmowa)

me_router = APIRouter(prefix="/api/me/messages", tags=["me"])
staff_router = APIRouter(prefix="/api/hr-messages", tags=["hr-messages"])


class MsgFileOut(BaseModel):
    id: int
    name: str
    size: int
    kind: Literal["image", "file"]
    width: int | None = None
    height: int | None = None


class MessageOut(BaseModel):
    id: int
    files: list[MsgFileOut] = []
    from_staff: bool
    mine: bool = False
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
    other_seen_at: datetime | None = None
    is_group: bool = False
    members: list["MemberOut"] = []
    batch_size: int | None = None


class MemberOut(BaseModel):
    employee_id: int | None = None
    name: str
    number: str | None = None


class ThreadRow(BaseModel):
    id: int
    subject: str
    status: Status
    updated_at: datetime
    last_from_staff: bool
    preview: str
    unread: bool = False
    unread_count: int = 0
    archived: bool = False
    employee_id: int | None = None
    employee_name: str | None = None
    employee_number: str | None = None
    is_group: bool = False
    member_count: int = 0
    batch_size: int | None = None


def _ename(e: Employee) -> str:
    return f"{e.last_name} {e.first_name}"


def _group_label(t: HrThread) -> str:
    names = [_ename(m.employee) for m in t.members]
    head = ", ".join(names[:3])
    return f"{head} +{len(names) - 3}" if len(names) > 3 else head


def _member(t: HrThread, eid: int | None) -> HrThreadMember | None:
    return next((m for m in t.members if m.employee_id == eid), None)


def _seen(t: HrThread, staff: bool, eid: int | None = None) -> datetime | None:
    if staff:
        return t.staff_seen_at
    if t.is_group:
        m = _member(t, eid)
        return m.seen_at if m else None
    return t.employee_seen_at


def _set_seen(t: HrThread, staff: bool, eid: int | None, when: datetime) -> None:
    if staff:
        t.staff_seen_at = when
    elif t.is_group:
        m = _member(t, eid)
        if m:
            m.seen_at = when
    else:
        t.employee_seen_at = when


def _is_other(m: HrMessage, staff: bool, uid: int | None) -> bool:
    """Wiadomość drugiej strony: dla kadr – od pracownika; dla pracownika – od kadr albo innego uczestnika."""
    if staff:
        return not m.from_staff
    return m.from_staff or m.author_id != uid


def _author_name(m: HrMessage, staff: bool, t: HrThread) -> str | None:
    if m.from_staff:
        return m.author.full_name if staff and m.author else None
    if t.is_group and m.author and m.author.employee_id:  # w grupie widać, kto z uczestników pisze
        mem = _member(t, m.author.employee_id)
        return _ename(mem.employee) if mem else m.author.full_name
    return None


def _archived(t: HrThread, staff: bool, eid: int | None = None) -> bool:
    if staff:
        return t.staff_archived_at is not None
    if t.is_group:
        m = _member(t, eid)
        return m is not None and m.archived_at is not None
    return t.employee_archived_at is not None


def _out(t: HrThread, staff: bool, uid: int | None = None, eid: int | None = None) -> ThreadOut:
    others_seen = (
        [m.seen_at for m in t.members if m.employee_id != eid and m.seen_at]
        if t.is_group
        else [t.employee_seen_at if staff else t.staff_seen_at]
    )
    if t.is_group and not staff:
        others_seen = [t.staff_seen_at, *others_seen]
    seen_vals = [x for x in others_seen if x]
    return ThreadOut(
        id=t.id,
        archived=_archived(t, staff, eid),
        is_group=t.is_group,
        batch_size=t.batch_size if staff else None,
        members=[
            MemberOut(
                employee_id=m.employee_id if staff else None,
                name=_ename(m.employee),
                number=format_number(m.employee.number) if staff else None,
            )
            for m in t.members
        ],
        subject=t.subject,
        status=t.status,  # type: ignore[arg-type]
        created_at=t.created_at,
        updated_at=t.updated_at,
        messages=[
            MessageOut(
                id=m.id,
                from_staff=m.from_staff,
                mine=(m.from_staff if staff else (not m.from_staff and m.author_id == uid)),
                kind=m.kind,  # type: ignore[arg-type]
                author_name=_author_name(m, staff, t),
                body=m.body,
                created_at=m.created_at,
                files=[
                    MsgFileOut(
                        id=f.id,
                        name=f.original_name,
                        size=f.size,
                        kind="image" if f.content_type.startswith("image/") else "file",
                        width=f.width,
                        height=f.height,
                    )
                    for f in m.files
                ],
            )
            for m in t.messages
        ],
        employee_id=t.employee_id if staff else None,
        employee_name=(_group_label(t) if t.is_group else _ename(t.employee))
        if staff and (t.is_group or t.employee)
        else None,
        employee_number=format_number(t.employee.number) if staff and t.employee else None,
        # „przeczytana”: w grupie – gdy przeczytał choć jeden z pozostałych
        other_seen_at=max(seen_vals) if seen_vals else None,
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
        if t.is_group:  # wspólna rozmowa nie zamyka się sama – kadry kończą ją ręcznie
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
        for m in t.members:
            m.archived_at = m.archived_at or now
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
    if not staff and t.is_group:
        m = _member(t, ctx.user.employee_id)
        if m:
            m.archived_at = utcnow() if on else None
    else:
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
            for m in t.members:
                m.archived_at = None
        t.messages.append(HrMessage(kind="status", from_staff=staff, author_id=user.id, body=new))


def _unread(t: HrThread, staff: bool, uid: int | None = None, eid: int | None = None) -> bool:
    """Ostatnia wiadomość jest od drugiej strony i nie była jeszcze otwarta."""
    last = _last(t)
    seen = _seen(t, staff, eid)
    return _is_other(last, staff, uid) and (seen is None or seen < last.created_at)


def _unread_count(t: HrThread, staff: bool, uid: int | None = None, eid: int | None = None) -> int:
    """Liczba wiadomości od drugiej strony, których jeszcze nie otwarto."""
    seen = _seen(t, staff, eid)
    return sum(
        1
        for m in t.messages
        if m.kind == "message" and _is_other(m, staff, uid) and (seen is None or m.created_at > seen)
    )


def _row(t: HrThread, staff: bool, uid: int | None = None, eid: int | None = None) -> ThreadRow:
    last = _last(t)
    return ThreadRow(
        id=t.id,
        subject=t.subject,
        status=t.status,  # type: ignore[arg-type]
        updated_at=t.updated_at,
        last_from_staff=last.from_staff,
        preview=(last.body or _files_label(last))[:120],
        unread=_unread(t, staff, uid, eid),
        unread_count=_unread_count(t, staff, uid, eid),
        archived=_archived(t, staff, eid),
        employee_id=t.employee_id if staff else None,
        employee_name=(_group_label(t) if t.is_group else _ename(t.employee))
        if staff and (t.is_group or t.employee)
        else None,
        employee_number=format_number(t.employee.number) if staff and t.employee else None,
        is_group=t.is_group,
        member_count=len(t.members),
        batch_size=t.batch_size if staff else None,
    )


def _files_label(m: HrMessage) -> str:
    imgs = sum(1 for f in m.files if f.content_type.startswith("image/"))
    other = len(m.files) - imgs
    parts = []
    if imgs:
        parts.append("Zdjęcie" if imgs == 1 else f"Zdjęcia: {imgs}")
    if other:
        parts.append(f"Plik: {m.files[-1].original_name}" if other == 1 else f"Pliki: {other}")
    return ", ".join(parts) or "Załącznik"


async def _read_uploads(files: list[UploadFile] | None) -> list[message_files.Prepared]:
    ups = [f for f in (files or []) if f.filename]
    if len(ups) > message_files.MAX_FILES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Najwyżej {message_files.MAX_FILES} plików w wiadomości."
        )
    out = []
    for f in ups:
        raw = await f.read(message_files.MAX_MB * 1024 * 1024 + 1)
        try:
            out.append(message_files.prepare(f.filename or "plik", raw))
        except message_files.FileError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return out


def _attach(db: DbSession, t: HrThread, m: HrMessage, prepared: list[message_files.Prepared]) -> None:
    for p in prepared:
        f = HrMessageFile(
            original_name=p.name,
            file_name="tmp",
            content_type=p.content_type,
            size=len(p.data),
            width=p.width,
            height=p.height,
        )
        m.files.append(f)
        db.flush()
        f.file_name = message_files.write(t.id, f.id, p)


def _file_response(db: DbSession, file_id: int, thumb: bool, can: Callable[[HrThread], bool]) -> Response:
    f = db.get(HrMessageFile, file_id)
    if f is None or not can(f.message.thread):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pliku.")
    data = message_files.read(f.message.thread_id, f.file_name, thumb and f.content_type.startswith("image/"))
    ctype = "image/jpeg" if thumb and f.content_type.startswith("image/") else f.content_type
    from urllib.parse import quote

    return Response(
        data,
        media_type=ctype,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(f.original_name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _employee_id(ctx: Auth) -> int:
    if ctx.user.role != Role.employee or ctx.user.employee_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    return ctx.user.employee_id


def _own_thread(db: DbSession, employee_id: int, thread_id: int) -> HrThread:
    t = db.get(HrThread, thread_id)
    if t is None or (t.employee_id != employee_id and _member(t, employee_id) is None):
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
    rows = [t for t in _mine(db, eid) if not _archived(t, False, eid)]
    return {"unread": sum(1 for t in rows if _unread(t, False, ctx.user.id, eid))}


@me_router.get("", response_model=list[ThreadRow])
def my_threads(ctx: Auth, db: DbSession, archived: bool = False) -> list[ThreadRow]:
    eid = _employee_id(ctx)
    close_stale(db)
    rows = [t for t in _mine(db, eid) if _archived(t, False, eid) == archived]
    return [_row(t, False, ctx.user.id, eid) for t in rows]


def _mine(db: DbSession, eid: int) -> list[HrThread]:
    """Rozmowy pracownika: własne i grupowe, w których uczestniczy (najnowsze najpierw)."""
    group_ids = select(HrThreadMember.thread_id).where(HrThreadMember.employee_id == eid)
    return list(
        db.scalars(
            select(HrThread)
            .where(or_(HrThread.employee_id == eid, HrThread.id.in_(group_ids)))
            .order_by(HrThread.updated_at.desc())
        ).unique()
    )


@me_router.get("/{thread_id}", response_model=ThreadOut)
def my_thread(thread_id: int, ctx: Auth, db: DbSession) -> ThreadOut:
    eid = _employee_id(ctx)
    t = _own_thread(db, eid, thread_id)
    if _unread(t, False, ctx.user.id, eid):
        _set_seen(t, False, eid, utcnow())
        db.commit()
    return _out(t, False, ctx.user.id, eid)


@me_router.post("/{thread_id}/archive", response_model=ThreadOut)
def my_archive(thread_id: int, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    eid = _employee_id(ctx)
    t = _own_thread(db, eid, thread_id)
    _archive(db, t, False, True, ctx, request)
    return _out(t, False, ctx.user.id, eid)


@me_router.post("/{thread_id}/unarchive", response_model=ThreadOut)
def my_unarchive(thread_id: int, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    eid = _employee_id(ctx)
    t = _own_thread(db, eid, thread_id)
    _archive(db, t, False, False, ctx, request)
    return _out(t, False, ctx.user.id, eid)


class NewThreadIn(BaseModel):
    subject: str = Field(max_length=80)
    body: str = Field(min_length=1, max_length=2000)


class BodyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


def _uid_of(db: DbSession, eid: int) -> int:
    from app.models import User

    return db.scalar(select(User.id).where(User.employee_id == eid)) or -1


def _check_rate(db: DbSession, eid: int) -> None:
    sent = db.scalar(
        select(func.count())
        .select_from(HrMessage)
        .join(HrThread, HrThread.id == HrMessage.thread_id)
        .where(
            or_(HrThread.employee_id == eid, HrMessage.author_id == _uid_of(db, eid)),
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
    return _out(t, False, ctx.user.id, eid)


@me_router.get("/files/{file_id}")
def my_file(file_id: int, ctx: Auth, db: DbSession, thumb: bool = False) -> Response:
    eid = _employee_id(ctx)
    return _file_response(db, file_id, thumb, lambda t: t.employee_id == eid or _member(t, eid) is not None)


@me_router.post("/{thread_id}/files", response_model=ThreadOut)
async def my_reply_files(
    thread_id: int,
    ctx: Auth,
    request: Request,
    db: DbSession,
    body: Annotated[str, Form(max_length=2000)] = "",
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> ThreadOut:
    prepared = await _read_uploads(files)
    return _my_reply(thread_id, body, prepared, ctx, request, db)


@me_router.post("/{thread_id}/messages", response_model=ThreadOut)
def my_reply(thread_id: int, body: BodyIn, ctx: Auth, request: Request, db: DbSession) -> ThreadOut:
    return _my_reply(thread_id, body.body, [], ctx, request, db)


def _my_reply(
    thread_id: int, raw: str, prepared: list, ctx: Auth, request: Request, db: DbSession
) -> ThreadOut:
    eid = _employee_id(ctx)
    t = _own_thread(db, eid, thread_id)
    text = raw.strip()
    if not text and not prepared:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz treść wiadomości.")
    _check_rate(db, eid)
    now = utcnow()
    msg = HrMessage(from_staff=False, author_id=ctx.user.id, body=text, created_at=now)
    t.messages.append(msg)
    db.flush()
    _attach(db, t, msg, prepared)
    if t.status == "done":
        _change_status(t, "new", ctx.user, False)
    t.updated_at = now
    _set_seen(t, False, eid, now)
    audit(
        db,
        request,
        "hr_message_sent",
        user=ctx.user,
        entity_type="employee",
        entity_id=eid,
        details={"thread": t.id, **({"files": len(prepared)} if prepared else {})},
    )
    db.commit()
    db.refresh(t)
    _push_staff(db)
    if t.is_group:  # pozostali uczestnicy dostają powiadomienie (bez treści)
        _notify_members(t, skip=eid)
    return _out(t, False, ctx.user.id, eid)


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
        .outerjoin(Employee, Employee.id == HrThread.employee_id)
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


@staff_router.get("/files/{file_id}")
def staff_file(file_id: int, ctx: StaffAuth, db: DbSession, thumb: bool = False) -> Response:
    return _file_response(db, file_id, thumb, lambda t: True)


@staff_router.post("/{thread_id}/files", response_model=ThreadOut)
async def staff_reply_files(
    thread_id: int,
    ctx: StaffAuth,
    request: Request,
    db: DbSession,
    body: Annotated[str, Form(max_length=2000)] = "",
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> ThreadOut:
    prepared = await _read_uploads(files)
    return _staff_reply(thread_id, body, prepared, ctx, request, db)


@staff_router.post("/{thread_id}/messages", response_model=ThreadOut)
def staff_reply(thread_id: int, body: BodyIn, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    return _staff_reply(thread_id, body.body, [], ctx, request, db)


def _staff_reply(
    thread_id: int, raw: str, prepared: list, ctx: StaffAuth, request: Request, db: DbSession
) -> ThreadOut:
    t = _thread(db, thread_id)
    text = raw.strip()
    if not text and not prepared:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz treść odpowiedzi.")
    now = utcnow()
    msg = HrMessage(from_staff=True, author_id=ctx.user.id, body=text, created_at=now)
    t.messages.append(msg)
    db.flush()
    _attach(db, t, msg, prepared)
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
        details={"thread": t.id, **({"files": len(prepared)} if prepared else {})},
    )
    db.commit()
    if t.is_group:
        _notify_members(t)
    else:
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
    employee_id: int | None = None
    employee_ids: list[int] = Field(default_factory=list, max_length=MAX_RECIPIENTS)
    # kilka osób: "separate" – osobna rozmowa z każdym, "group" – jedna wspólna rozmowa
    mode: Literal["separate", "group"] = "separate"
    subject: str = Field(min_length=3, max_length=80)
    body: str = Field(min_length=1, max_length=2000)


MAX_STAFF_PER_HOUR = 30


@staff_router.post("", response_model=ThreadOut, status_code=status.HTTP_201_CREATED)
def staff_start(body: StaffNewIn, ctx: StaffAuth, request: Request, db: DbSession) -> ThreadOut:
    """Kadry zaczynają rozmowę z pracownikiem (albo kilkoma) z aktywnym kontem (inaczej jej nie przeczyta).

    Kilka osób: osobne rozmowy z jednej wysyłki (batch_id, odpowiedzi widzą tylko kadry) albo jedna
    wspólna rozmowa grupowa (uczestnicy widzą swoje wiadomości i nazwiska). Zwraca pierwszą / wspólną rozmowę.
    """
    import uuid

    from app.routers.passkeys import employee_account

    ids = list(dict.fromkeys([*([body.employee_id] if body.employee_id else []), *body.employee_ids]))
    if not ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wybierz odbiorcę.")
    if len(ids) > MAX_RECIPIENTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Najwyżej {MAX_RECIPIENTS} odbiorców naraz.")
    people: list[Employee] = []
    for i in ids:
        e = db.get(Employee, i)
        if e is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
        if employee_account(db, e.id) is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{_ename(e)} nie ma aktywnego konta w aplikacji, więc nie przeczyta wiadomości."
                    if len(ids) > 1
                    else "Ten pracownik nie ma aktywnego konta w aplikacji, więc nie przeczyta wiadomości."
                ),
            )
        people.append(e)
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
    # wysyłka do kilku osób liczy się jak jedna wiadomość (limit chroni przed pomyłkową serią)
    if (sent or 0) >= MAX_STAFF_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Za dużo wiadomości. Spróbuj za godzinę."
        )
    now = utcnow()
    group = body.mode == "group" and len(people) > 1
    batch = uuid.uuid4().hex if len(people) > 1 and not group else None
    threads: list[HrThread] = []
    for e in [None] if group else people:
        t = HrThread(
            employee_id=e.id if e else None,
            is_group=group,
            batch_id=batch,
            batch_size=len(people) if len(people) > 1 else None,
            subject=subject,
            status="in_progress",
            created_at=now,
            updated_at=now,
            staff_seen_at=now,
        )
        if group:
            t.members = [HrThreadMember(employee_id=p.id) for p in people]
        t.messages.append(HrMessage(from_staff=True, author_id=ctx.user.id, body=text, created_at=now))
        db.add(t)
        threads.append(t)
    db.flush()
    for t in threads:
        for p in people if group else [t.employee]:
            audit(
                db,
                request,
                "hr_thread_started_by_staff",
                user=ctx.user,
                entity_type="employee",
                entity_id=p.id,
                details={
                    "thread": t.id,
                    "subject": subject,
                    "number": format_number(p.number),
                    **(
                        {"mode": "group" if group else "separate", "recipients": len(people)}
                        if len(people) > 1
                        else {}
                    ),
                },
            )
    db.commit()
    for t in threads:
        if group:
            _notify_members(t, started=True)
        else:
            _notify_employee(t, started=True)
    first = threads[0]
    db.refresh(first)
    return _out(first, True)


def _push_staff(db: DbSession) -> None:
    """Powiadomienie push dla kadr i administratorów (ogólne, bez nazwiska i treści)."""
    from app import push
    from app.models import Role, User

    ids = list(db.scalars(select(User.id).where(User.role.in_([Role.admin, Role.hr]), User.is_active)))
    push.notify_users(db, ids, "Nowa wiadomość od pracownika", "Sprawdź skrzynkę w aplikacji.", "/wiadomosci")


def _notify_members(t: HrThread, started: bool = False, skip: int | None = None) -> None:
    """Rozmowa grupowa: powiadomienie push dla uczestników (bez treści i bez nazwisk)."""
    from app import i18n, push
    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as pdb:
        for m in t.members:
            if m.employee_id == skip:
                continue
            acct = pdb.scalar(select(User).where(User.employee_id == m.employee_id, User.is_active))
            if acct is None:
                continue
            push.notify_users(
                pdb,
                [acct.id],
                i18n.t(pdb, "Wiadomość w rozmowie grupowej", acct.language),
                i18n.t(pdb, "Nowa wiadomość w rozmowie „{subject}”.", acct.language).replace(
                    "{subject}", t.subject
                ),
                "/moje-konto/wiadomosci",
            )


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
