"""Błędy aplikacji: zgłoszenia z przeglądarki (każdy zalogowany) i lista dla administratora (Stan systemu)."""

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import errors
from app.deps import AdminAuth, Auth, DbSession, utcnow
from app.models import AppError

router = APIRouter(tags=["system"])


class ClientError(BaseModel):
    kind: str = Field("Błąd", max_length=200)
    message: str = Field("", max_length=2000)
    path: str = Field("", max_length=500)


@router.post("/api/client-errors", status_code=status.HTTP_204_NO_CONTENT)
def report_client_error(body: ClientError, ctx: Auth) -> Response:
    """Przeglądarka zgłasza błąd JS. Treść jest czyszczona z danych osobowych przed zapisem
    (app/errors.py)."""
    if errors.browser_allowed(ctx.user.id):
        role = getattr(ctx.user.role, "value", ctx.user.role)
        errors.record("browser", body.kind, body.message, body.path, None, str(role))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class AppErrorOut(BaseModel):
    id: int
    source: str
    kind: str
    message: str
    path: str
    status: int | None
    role: str | None
    count: int
    first_at: datetime
    last_at: datetime
    resolved_at: datetime | None = None
    resolved_by: str | None = None
    reopened: bool = False

    model_config = {"from_attributes": True}


@router.get("/api/system/errors", response_model=list[AppErrorOut])
def list_errors(ctx: AdminAuth, db: DbSession, days: int = 7, resolved: bool = False) -> list[AppError]:
    """Bieżące błędy z ostatnich `days` dni albo archiwum rozwiązanych (do 30 dni)."""
    if resolved:
        q = select(AppError).where(AppError.resolved_at.is_not(None)).order_by(AppError.resolved_at.desc())
    else:
        since = utcnow() - timedelta(days=max(1, min(days, errors.KEEP_DAYS)))
        q = (
            select(AppError)
            .where(AppError.resolved_at.is_(None), AppError.last_at >= since)
            .order_by(AppError.last_at.desc())
        )
    return list(db.scalars(q.limit(100)))


@router.get("/api/system/errors/counts")
def error_counts(ctx: AdminAuth, db: DbSession, days: int = 7) -> dict[str, int]:
    since = utcnow() - timedelta(days=max(1, min(days, errors.KEEP_DAYS)))
    open_n = db.scalar(
        select(func.count())
        .select_from(AppError)
        .where(AppError.resolved_at.is_(None), AppError.last_at >= since)
    )
    done_n = db.scalar(select(func.count()).select_from(AppError).where(AppError.resolved_at.is_not(None)))
    return {"open": open_n or 0, "resolved": done_n or 0}


@router.post("/api/system/errors/{error_id}/resolve", response_model=AppErrorOut)
def resolve_error(error_id: int, ctx: AdminAuth, db: DbSession) -> AppError:
    """„Rozwiązany” – wpis przechodzi do archiwum (data i osoba); gdy błąd wróci, wraca do bieżących."""
    row = db.get(AppError, error_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiego błędu.")
    row.resolved_at = utcnow()
    row.resolved_by = ctx.user.full_name or ctx.user.username
    row.reopened = False
    db.commit()
    return row


@router.post("/api/system/errors/{error_id}/reopen", response_model=AppErrorOut)
def reopen_error(error_id: int, ctx: AdminAuth, db: DbSession) -> AppError:
    """„Przywróć” – cofa rozwiązanie."""
    row = db.get(AppError, error_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiego błędu.")
    row.resolved_at = None
    row.resolved_by = None
    db.commit()
    return row
