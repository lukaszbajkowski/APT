"""Błędy aplikacji: zgłoszenia z przeglądarki (każdy zalogowany) i lista dla administratora (Stan systemu)."""

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

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

    model_config = {"from_attributes": True}


@router.get("/api/system/errors", response_model=list[AppErrorOut])
def list_errors(ctx: AdminAuth, db: DbSession, days: int = 7) -> list[AppError]:
    since = utcnow() - timedelta(days=max(1, min(days, errors.KEEP_DAYS)))
    return list(
        db.scalars(
            select(AppError).where(AppError.last_at >= since).order_by(AppError.last_at.desc()).limit(100)
        )
    )


@router.delete("/api/system/errors/{error_id}", status_code=status.HTTP_204_NO_CONTENT)
def resolve_error(error_id: int, ctx: AdminAuth, db: DbSession) -> Response:
    """„Rozwiązany” – wpis znika; jeśli błąd wróci, pojawi się od nowa z licznikiem od 1."""
    row = db.get(AppError, error_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiego błędu.")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
