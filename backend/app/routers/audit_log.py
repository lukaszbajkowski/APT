from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.deps import AdminAuth, DbSession
from app.models import AuditLog
from app.schemas import AuditOut, Page

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=Page[AuditOut])
def list_audit(
    ctx: AdminAuth,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: str | None = None,
    username: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> Page[AuditOut]:
    conditions = []
    if action:
        conditions.append(AuditLog.action == action)
    if username:
        conditions.append(AuditLog.username.ilike(f"%{username.strip()}%"))
    if date_from:
        conditions.append(AuditLog.ts >= date_from)
    if date_to:
        conditions.append(AuditLog.ts < date_to)

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*conditions)) or 0
    rows = db.scalars(
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.ts.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return Page[AuditOut](
        items=[AuditOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.get("/actions", response_model=list[str])
def list_actions(ctx: AdminAuth, db: DbSession) -> list[str]:
    return list(db.scalars(select(AuditLog.action).distinct().order_by(AuditLog.action)))
