"""Raporty i eksport do Excela. Zakres kierownika jak wszędzie; każdy eksport trafia do dziennika."""

import io
from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import BaseModel
from sqlalchemy import select

from app import crypto
from app.audit import audit
from app.deps import AuthContext, DbSession, require_roles
from app.models import Employee, EmployeeStatus, Role
from app.routers.employees import Filters, age_on, apply_scope, format_number, full_access

router = APIRouter(prefix="/api/reports", tags=["reports"])

ReportAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]
MAX_EXPORT = 20000
TZ = ZoneInfo("Europe/Warsaw")

NAVY = "1F3A73"
HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor=NAVY)
TITLE_FONT = Font(bold=True, size=14, color=NAVY)
MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"]
NONE = "(brak)"


def _sheet_table(ws: Worksheet, headers: list[str], rows: list[list[Any]], start_row: int = 1) -> None:
    """Nagłówek w kolorze aplikacji, filtr, zamrożony wiersz, szerokości kolumn."""
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=start_row, column=c, value=h)
        cell.font, cell.fill = HEADER_FONT, HEADER_FILL
        cell.alignment = Alignment(vertical="center")
    for r, row in enumerate(rows, start_row + 1):
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=v)
            if isinstance(v, date):
                cell.number_format = "DD.MM.YYYY"
    last = start_row + max(len(rows), 1)
    ws.auto_filter.ref = f"A{start_row}:{get_column_letter(len(headers))}{last}"
    ws.freeze_panes = ws.cell(row=start_row + 1, column=1)
    for c, h in enumerate(headers, 1):
        width = max([len(str(h))] + [len(_fmt(r[c - 1])) for r in rows[:2000]]) + 2
        ws.column_dimensions[get_column_letter(c)].width = min(max(width, 8), 50)


def _fmt(v: Any) -> str:
    if isinstance(v, date):
        return "00.00.0000"
    return "" if v is None else str(v)


def _xlsx(wb: Workbook, name: str) -> Response:
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


def _stamp() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d_%H%M")


# --- eksport listy pracowników ----------------------------------------------------


@router.get("/employees.xlsx")
def export_employees(
    ctx: ReportAuth,
    request: Request,
    db: DbSession,
    filters: Filters,
    include_pesel: Annotated[bool, Query()] = False,
) -> Response:
    user = ctx.user
    personal = full_access(user)
    if include_pesel and not personal:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień do eksportu numerów PESEL.")
    emps = list(db.scalars(filters.query(user).order_by(*filters.order()).limit(MAX_EXPORT + 1)).unique())
    if len(emps) > MAX_EXPORT:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Za dużo wyników (ponad {MAX_EXPORT}). Zawęź filtry."
        )

    today = date.today()
    headers = ["Nr", "Nazwisko", "Imię", "APT", "Wydział", "Stanowisko", "Obywatelstwo", "Płeć"]
    headers += ["Data urodzenia"] if personal else ["Wiek"]
    if include_pesel:
        headers.append("PESEL")
    headers += ["Data zatrudnienia", "Data zwolnienia", "Status", "Zdjęcie", "Uwagi"]

    rows = []
    for e in emps:
        row: list[Any] = [
            format_number(e.number),
            e.last_name,
            e.first_name,
            e.agency.name if e.agency else None,
            e.department.name if e.department else None,
            e.position.name if e.position else None,
            e.country.name if e.country else None,
            {"K": "kobieta", "M": "mężczyzna"}.get(e.sex.value) if e.sex else None,
            e.birth_date if personal else age_on(e.birth_date, today),
        ]
        if include_pesel:
            row.append(crypto.decrypt(e.pesel_enc) if e.pesel_enc else None)
        row += [
            e.hire_date,
            e.termination_date,
            "aktywny" if e.status == EmployeeStatus.active else "archiwum",
            "tak" if e.photo else "nie",
            e.notes,
        ]
        rows.append(row)

    wb = Workbook()
    ws = wb.active
    ws.title = "Pracownicy"
    _sheet_table(ws, headers, rows)
    if include_pesel:
        ws.oddHeader.center.text = "Zawiera numery PESEL – dane poufne"

    params = {k: v for k, v in request.query_params.multi_items() if k != "include_pesel"}
    audit(
        db,
        request,
        "employees_exported",
        user=user,
        entity_type="report",
        details={"count": len(rows), "filters": params, "include_pesel": include_pesel},
    )
    db.commit()
    return _xlsx(wb, f"pracownicy_{_stamp()}.xlsx")


# --- zestawienia ------------------------------------------------------------------


class Row(BaseModel):
    name: str
    count: int


class CrossRow(BaseModel):
    agency: str
    department: str
    count: int


class MonthRow(BaseModel):
    month: str  # RRRR-MM
    label: str
    hired: int
    terminated: int


class SummaryOut(BaseModel):
    generated_at: datetime
    active: int
    terminated: int
    by_agency: list[Row]
    by_department: list[Row]
    by_position: list[Row]
    by_country: list[Row]
    by_sex: list[Row]
    agency_department: list[CrossRow]
    months: list[MonthRow]
    missing_photo: int
    missing_pesel: int | None


def _rows(counter: Counter) -> list[Row]:
    return [Row(name=k, count=v) for k, v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))]


def _last_months(today: date, n: int = 12) -> list[tuple[int, int]]:
    out, y, m = [], today.year, today.month
    for _ in range(n):
        out.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(out))


def build_summary(db, user) -> SummaryOut:
    emps = list(db.scalars(apply_scope(select(Employee), user)).unique())
    active = [e for e in emps if e.status == EmployeeStatus.active]
    name = lambda r: r.name if r else NONE  # noqa: E731

    cross: dict[tuple[str, str], int] = defaultdict(int)
    for e in active:
        cross[(name(e.agency), name(e.department))] += 1

    today = date.today()
    months = []
    for y, m in _last_months(today):
        months.append(
            MonthRow(
                month=f"{y}-{m:02d}",
                label=f"{MONTHS[m - 1]} {y}",
                hired=sum(1 for e in emps if e.hire_date and (e.hire_date.year, e.hire_date.month) == (y, m)),
                terminated=sum(
                    1
                    for e in emps
                    if e.termination_date and (e.termination_date.year, e.termination_date.month) == (y, m)
                ),
            )
        )
    sex = Counter({"K": "kobiety", "M": "mężczyźni"}.get(e.sex.value if e.sex else "", NONE) for e in active)
    return SummaryOut(
        generated_at=datetime.now(TZ),
        active=len(active),
        terminated=len(emps) - len(active),
        by_agency=_rows(Counter(name(e.agency) for e in active)),
        by_department=_rows(Counter(name(e.department) for e in active)),
        by_position=_rows(Counter(name(e.position) for e in active)),
        by_country=_rows(Counter(name(e.country) for e in active)),
        by_sex=_rows(sex),
        agency_department=[
            CrossRow(agency=a, department=d, count=c)
            for (a, d), c in sorted(cross.items(), key=lambda kv: kv[0])
        ],
        months=months,
        missing_photo=sum(1 for e in active if e.photo is None),
        missing_pesel=sum(1 for e in active if e.pesel_hash is None) if full_access(user) else None,
    )


@router.get("/summary", response_model=SummaryOut)
def summary(ctx: ReportAuth, db: DbSession) -> SummaryOut:
    return build_summary(db, ctx.user)


@router.get("/summary.xlsx")
def summary_xlsx(ctx: ReportAuth, request: Request, db: DbSession) -> Response:
    s = build_summary(db, ctx.user)
    wb = Workbook()

    ws = wb.active
    ws.title = "Podsumowanie"
    ws["A1"] = "Zestawienie pracowników"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = f"Wygenerowano {s.generated_at:%d.%m.%Y %H:%M} · {ctx.user.full_name}"
    ws["A2"].font = Font(italic=True, color="6B7280")
    summary_rows: list[list[Any]] = [
        ["Aktywni pracownicy", s.active],
        ["W archiwum", s.terminated],
        ["Aktywni bez zdjęcia", s.missing_photo],
    ]
    if s.missing_pesel is not None:
        summary_rows.append(["Aktywni bez PESEL", s.missing_pesel])
    _sheet_table(ws, ["Wskaźnik", "Liczba"], summary_rows, start_row=4)
    ws.auto_filter.ref = None

    def counts(title: str, header: str, rows: list[Row]) -> None:
        sh = wb.create_sheet(title)
        total = sum(r.count for r in rows) or 1
        _sheet_table(
            sh, [header, "Aktywni", "Udział"], [[r.name, r.count, round(r.count / total, 4)] for r in rows]
        )
        for r in range(2, len(rows) + 2):
            sh.cell(row=r, column=3).number_format = "0.0%"

    counts("APT", "APT", s.by_agency)
    counts("Wydziały", "Wydział", s.by_department)
    cs = wb.create_sheet("APT × wydział")
    _sheet_table(
        cs, ["APT", "Wydział", "Aktywni"], [[r.agency, r.department, r.count] for r in s.agency_department]
    )
    counts("Stanowiska", "Stanowisko", s.by_position)
    counts("Obywatelstwo", "Obywatelstwo", s.by_country)
    counts("Płeć", "Płeć", s.by_sex)
    ms = wb.create_sheet("Ruch 12 mies.")
    _sheet_table(
        ms,
        ["Miesiąc", "Zatrudnieni", "Zwolnieni", "Saldo"],
        [[m.label, m.hired, m.terminated, m.hired - m.terminated] for m in s.months],
    )

    audit(db, request, "report_exported", user=ctx.user, entity_type="report", details={"report": "summary"})
    db.commit()
    return _xlsx(wb, f"zestawienie_{_stamp()}.xlsx")
