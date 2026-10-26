"""Zestawienie miesięczne dla agencji pracy: podgląd, Excel, wysyłka e-mailem."""

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select

from app import agency_report
from app.audit import audit
from app.deps import AuthContext, DbSession, StaffAuth, require_roles
from app.models import Agency, AuditLog, Role

router = APIRouter(prefix="/api/agency-report", tags=["agency-report"])
ViewAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.agency))]
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class RowOut(BaseModel):
    employee_id: int
    number: str
    last_name: str
    first_name: str
    department: str | None
    position: str | None
    hire_date: date | None
    termination_date: date | None
    period_from: date
    period_to: date
    days: int
    change: str


class ReportOut(BaseModel):
    agency_id: int
    agency: str
    month: str
    label: str
    recipients: list[str]
    last_sent_at: datetime | None
    last_sent_to: list[str]
    people: int
    came: int
    left: int
    rows: list[RowOut]


def _agency(db: DbSession, ctx: AuthContext, agency_id: int | None) -> Agency:
    if ctx.user.role == Role.agency:
        agency_id = ctx.user.agency_id  # konto agencji – zawsze tylko własna APT
    ag = db.get(Agency, agency_id) if agency_id else None
    if ag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono APT.")
    return ag


def _month(month: str | None) -> str:
    month = month or agency_report.previous_month()
    try:
        agency_report.month_range(month)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return month


@router.get("", response_model=ReportOut)
def get_report(
    ctx: ViewAuth, db: DbSession, agency_id: int | None = None, month: str | None = None
) -> ReportOut:
    ag, month = _agency(db, ctx, agency_id), _month(month)
    rows = agency_report.rows_for(db, ag, month)
    sent = [
        a
        for a in db.scalars(
            select(AuditLog)
            .where(AuditLog.action == "agency_report_sent", AuditLog.entity_id == str(ag.id))
            .order_by(AuditLog.ts.desc())
        )
        if (a.details or {}).get("month") == month
    ]
    last = sent[0] if sent else None
    return ReportOut(
        agency_id=ag.id,
        agency=ag.name,
        month=month,
        label=agency_report.month_label(month),
        recipients=agency_report.recipients(ag),
        last_sent_at=last.ts if last else None,
        last_sent_to=(last.details or {}).get("to", []) if last else [],
        people=len({r.employee_id for r in rows}),
        came=sum(1 for r in rows if r.change.startswith("przyjęty")),
        left=sum(1 for r in rows if "odszedł" in r.change),
        rows=[RowOut(**r.__dict__) for r in rows],
    )


@router.get("/xlsx")
def get_xlsx(
    ctx: ViewAuth, request: Request, db: DbSession, agency_id: int | None = None, month: str | None = None
) -> Response:
    ag, month = _agency(db, ctx, agency_id), _month(month)
    data = agency_report.xlsx(ag, month, agency_report.rows_for(db, ag, month))
    audit(
        db,
        request,
        "agency_report_downloaded",
        user=ctx.user,
        entity_type="agency",
        entity_id=ag.id,
        details={"agency": ag.name, "month": month},
    )
    db.commit()
    name = agency_report.file_name(ag, month)
    return Response(
        data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


class SendIn(BaseModel):
    agency_id: int
    month: str


class SendOut(BaseModel):
    sent_to: list[str]


@router.post("/send", response_model=SendOut)
def send_report(body: SendIn, ctx: StaffAuth, request: Request, db: DbSession) -> SendOut:
    ag, month = _agency(db, ctx, body.agency_id), _month(body.month)
    if not agency_report.recipients(ag):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ta APT nie ma adresu e-mail – uzupełnij go w Słownikach (APT).",
        )
    sent = agency_report.send(db, ag, month, user=ctx.user, request=request)
    if not sent:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Wysyłka e-maili jest wyłączona.")
    return SendOut(sent_to=sent)
