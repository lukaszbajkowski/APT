"""Komunikaty techniczne: administrator ogłasza prace serwisowe, wdrożenia, prace naprawcze i awarie.

Aktywne komunikaty widzą wyłącznie zalogowani (pracownicy i personel) – przed logowaniem nic nie widać.
Komunikat „blokujący” w trakcie trwania (od–do) pokazuje zalogowanym poza administratorem ekran przerwy technicznej.
"""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_, select

from app.audit import audit
from app.deps import AdminAuth, Auth, DbSession, utcnow
from app.models import ServiceNotice

router = APIRouter(prefix="/api/service-notices", tags=["service-notices"])

Kind = Literal["planned", "deploy", "repair", "incident", "info"]
# zakończony komunikat bez daty końca znika po tylu dniach od ostatniej zmiany (żeby nie wisiał w nieskończoność)
STALE_DAYS = 14


class NoticeIn(BaseModel):
    kind: Kind
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(default="", max_length=1000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    blocking: bool = False
    published: bool = True

    @model_validator(mode="after")
    def _check(self) -> "NoticeIn":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("Koniec musi być po początku.")
        if self.blocking and not self.ends_at:
            raise ValueError("Przerwa blokująca aplikację musi mieć godzinę zakończenia.")
        return self


class NoticeOut(BaseModel):
    id: int
    kind: Kind
    title: str
    body: str
    starts_at: datetime | None
    ends_at: datetime | None
    blocking: bool
    published: bool
    # w trakcie: początek minął (albo brak) i koniec nie minął
    ongoing: bool
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime


def _out(n: ServiceNotice, now: datetime) -> NoticeOut:
    ongoing = (n.starts_at is None or n.starts_at <= now) and (n.ends_at is None or n.ends_at > now)
    return NoticeOut(
        id=n.id, kind=n.kind, title=n.title, body=n.body, starts_at=n.starts_at, ends_at=n.ends_at,  # type: ignore[arg-type]
        blocking=n.blocking, published=n.published, ongoing=ongoing, created_by_name=n.created_by_name,
        created_at=n.created_at, updated_at=n.updated_at,
    )


def active_notices(db, now: datetime) -> list[ServiceNotice]:  # noqa: ANN001
    """Opublikowane i jeszcze aktualne (koniec w przyszłości albo brak końca i świeża zmiana)."""
    stale = now - timedelta(days=STALE_DAYS)
    return list(
        db.scalars(
            select(ServiceNotice)
            .where(
                ServiceNotice.published.is_(True),
                or_(
                    ServiceNotice.ends_at > now,
                    (ServiceNotice.ends_at.is_(None)) & (ServiceNotice.updated_at > stale),
                ),
            )
            .order_by(ServiceNotice.starts_at.is_(None).desc(), ServiceNotice.starts_at, ServiceNotice.id)
        )
    )


@router.get("/current", response_model=list[NoticeOut])
def current(ctx: Auth, db: DbSession) -> list[NoticeOut]:
    """Aktywne komunikaty techniczne dla zalogowanego użytkownika (dowolna rola)."""
    now = utcnow()
    return [_out(n, now) for n in active_notices(db, now)]


@router.get("", response_model=list[NoticeOut])
def list_all(ctx: AdminAuth, db: DbSession) -> list[NoticeOut]:
    now = utcnow()
    rows = db.scalars(select(ServiceNotice).order_by(ServiceNotice.created_at.desc()).limit(200))
    return [_out(n, now) for n in rows]


def _apply(n: ServiceNotice, body: NoticeIn) -> None:
    n.kind = body.kind
    n.title = body.title.strip()
    n.body = body.body.strip()
    n.starts_at = body.starts_at
    n.ends_at = body.ends_at
    n.blocking = body.blocking
    n.published = body.published


@router.post("", response_model=NoticeOut, status_code=status.HTTP_201_CREATED)
def create(body: NoticeIn, ctx: AdminAuth, request: Request, db: DbSession) -> NoticeOut:
    n = ServiceNotice(created_by_name=ctx.user.full_name)
    _apply(n, body)
    db.add(n)
    db.flush()
    audit(db, request, "service_notice_created", user=ctx.user, entity_type="service_notice", entity_id=n.id,
          details={"kind": n.kind, "blocking": n.blocking})
    db.commit()
    db.refresh(n)
    return _out(n, utcnow())


def _get(db, notice_id: int) -> ServiceNotice:  # noqa: ANN001
    n = db.get(ServiceNotice, notice_id)
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono komunikatu.")
    return n


@router.put("/{notice_id}", response_model=NoticeOut)
def update(notice_id: int, body: NoticeIn, ctx: AdminAuth, request: Request, db: DbSession) -> NoticeOut:
    n = _get(db, notice_id)
    _apply(n, body)
    audit(db, request, "service_notice_updated", user=ctx.user, entity_type="service_notice", entity_id=n.id,
          details={"kind": n.kind, "blocking": n.blocking, "published": n.published})
    db.commit()
    db.refresh(n)
    return _out(n, utcnow())


@router.post("/{notice_id}/end", response_model=NoticeOut)
def end_now(notice_id: int, ctx: AdminAuth, request: Request, db: DbSession) -> NoticeOut:
    """Zakończ teraz (np. prace skończyły się wcześniej) – komunikat znika u wszystkich."""
    n = _get(db, notice_id)
    now = utcnow()
    n.ends_at = now
    if n.starts_at and n.starts_at > now:
        n.starts_at = now
    audit(db, request, "service_notice_ended", user=ctx.user, entity_type="service_notice", entity_id=n.id)
    db.commit()
    db.refresh(n)
    return _out(n, utcnow())


@router.delete("/{notice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(notice_id: int, ctx: AdminAuth, request: Request, db: DbSession) -> None:
    n = _get(db, notice_id)
    db.delete(n)
    audit(db, request, "service_notice_deleted", user=ctx.user, entity_type="service_notice", entity_id=notice_id)
    db.commit()
