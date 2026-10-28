"""Przegląd uprawnień (role, ostatnie logowania) i raport dostępu do PESEL. Tylko administrator."""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from app.audit import audit
from app.deps import AdminAuth, DbSession, utcnow
from app.models import Agency, AuditLog, Department, Role, User, WebauthnCredential

router = APIRouter(prefix="/api/access-review", tags=["access-review"])

STALE_DAYS = 90  # konto bez logowania tak długo warto wyłączyć


class UserReview(BaseModel):
    id: int
    username: str
    full_name: str
    role: Role
    is_active: bool
    email: str | None
    last_login_at: str | None
    days_since_login: int | None
    mfa: bool
    passkeys: int
    scope: list[str]
    flags: list[str]


@router.get("/users", response_model=list[UserReview])
def users(ctx: AdminAuth, db: DbSession) -> list[UserReview]:
    now = utcnow()
    keys = dict(
        db.execute(
            select(WebauthnCredential.user_id, func.count()).group_by(WebauthnCredential.user_id)
        ).all()
    )
    agencies = {a.id: a.name for a in db.scalars(select(Agency))}
    departments = {d.id: d.name for d in db.scalars(select(Department))}
    out: list[UserReview] = []
    rows = db.scalars(
        select(User)
        .where(User.role != Role.employee)
        .order_by(User.is_active.desc(), User.role, User.username)
    ).unique()
    for u in rows:
        days = (now - u.last_login_at).days if u.last_login_at else None
        flags: list[str] = []
        if u.is_active:
            if u.last_login_at is None:
                flags.append("nigdy się nie logował(-a)")
            elif days is not None and days >= STALE_DAYS:
                flags.append(f"brak logowania od {days} dni")
            if u.role in (Role.admin, Role.hr) and not u.mfa_enabled and not keys.get(u.id):
                flags.append("brak logowania dwuetapowego")
            if u.role == Role.admin:
                flags.append("pełne uprawnienia")
            if not u.email:
                flags.append("brak adresu e-mail")
        scope = [agencies.get(sc.agency_id, "?") for sc in u.scopes if sc.agency_id] + [
            departments.get(sc.department_id, "?") for sc in u.scopes if sc.department_id
        ]
        if u.role == Role.agency and u.agency_id:
            scope = [agencies.get(u.agency_id, "?")]
        out.append(
            UserReview(
                id=u.id,
                username=u.username,
                full_name=u.full_name,
                role=u.role,
                is_active=u.is_active,
                email=u.email,
                last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
                days_since_login=days,
                mfa=u.mfa_enabled,
                passkeys=keys.get(u.id, 0),
                scope=scope,
                flags=flags,
            )
        )
    return out


class PeselUser(BaseModel):
    username: str
    views: int
    employees: int
    last_at: str


class PeselEvent(BaseModel):
    ts: str
    username: str | None
    employee_id: str | None
    number: str | None


class ReportView(BaseModel):
    ts: str
    username: str | None


class PeselReport(BaseModel):
    days: int
    total: int
    report_views: list[ReportView]  # kto oglądał ten raport
    users: list[PeselUser]
    recent: list[PeselEvent]


@router.get("/pesel", response_model=PeselReport)
def pesel_access(
    ctx: AdminAuth, request: Request, db: DbSession, days: Annotated[int, Query(ge=1, le=365)] = 30
) -> PeselReport:
    # samo zajrzenie do raportu o dostępie do PESEL też zostaje w dzienniku i widać je w raporcie
    audit(db, request, "pesel_report_viewed", user=ctx.user, details={"days": days})
    db.commit()
    since = utcnow() - timedelta(days=days)
    base = (AuditLog.action == "pesel_viewed", AuditLog.ts >= since)
    agg = db.execute(
        select(
            AuditLog.username,
            func.count(),
            func.count(func.distinct(AuditLog.entity_id)),
            func.max(AuditLog.ts),
        )
        .where(*base)
        .group_by(AuditLog.username)
        .order_by(func.count().desc())
    ).all()
    recent = db.scalars(
        select(AuditLog).where(*base).order_by(AuditLog.ts.desc(), AuditLog.id.desc()).limit(100)
    )
    views = db.scalars(
        select(AuditLog)
        .where(AuditLog.action == "pesel_report_viewed", AuditLog.ts >= since)
        .order_by(AuditLog.ts.desc(), AuditLog.id.desc())
        .limit(50)
    )
    return PeselReport(
        days=days,
        total=sum(r[1] for r in agg),
        report_views=[ReportView(ts=v.ts.isoformat(), username=v.username) for v in views],
        users=[
            PeselUser(username=r[0] or "?", views=r[1], employees=r[2], last_at=r[3].isoformat()) for r in agg
        ],
        recent=[
            PeselEvent(
                ts=r.ts.isoformat(),
                username=r.username,
                employee_id=r.entity_id,
                number=(r.details or {}).get("number"),
            )
            for r in recent
        ],
    )
