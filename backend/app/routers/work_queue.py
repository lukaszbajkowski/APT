"""Kolejka pracy kadr: jedna lista rzeczy do zrobienia z wielu miejsc aplikacji."""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import DbSession, StaffAuth
from app.models import EmployeeRequest, HrThread

router = APIRouter(prefix="/api/work-queue", tags=["work-queue"])

LIMIT = 6  # tyle pozycji z każdej grupy pokazujemy od razu


class QueueItem(BaseModel):
    title: str
    detail: str | None = None
    url: str


class QueueGroup(BaseModel):
    key: str
    label: str
    count: int
    url: str  # lista pełna
    items: list[QueueItem]


class QueueOut(BaseModel):
    total: int
    groups: list[QueueGroup]


def _group(key: str, label: str, url: str, items: list[QueueItem], count: int | None = None) -> QueueGroup:
    return QueueGroup(
        key=key, label=label, count=count if count is not None else len(items), url=url, items=items[:LIMIT]
    )


@router.get("", response_model=QueueOut)
def queue(ctx: StaffAuth, db: DbSession) -> QueueOut:
    from app.routers.lifecycle import open_tasks
    from app.routers.permits import KINDS, latest_permits, permit_state
    from app.routers.quality import CHECKS, summary
    from app.routers.trainings import expiring

    user = ctx.user
    groups: list[QueueGroup] = []

    threads = list(
        db.scalars(
            select(HrThread)
            .where(HrThread.status == "new", HrThread.staff_archived_at.is_(None))
            .order_by(HrThread.updated_at)
        ).unique()
    )
    groups.append(
        _group(
            "messages",
            "Wiadomości od pracowników bez odpowiedzi",
            "/wiadomosci",
            [
                QueueItem(
                    title=f"{t.employee.last_name} {t.employee.first_name}",
                    detail=t.subject,
                    url="/wiadomosci",
                )
                for t in threads
            ],
        )
    )

    reqs = list(
        db.scalars(
            select(EmployeeRequest).where(EmployeeRequest.status == "pending").order_by(EmployeeRequest.id)
        ).unique()
    )
    groups.append(
        _group(
            "requests",
            "Zgłoszenia agencji do decyzji",
            "/zgloszenia",
            [
                QueueItem(
                    title=f"{r.last_name} {r.first_name}",
                    detail=r.agency.name if r.agency else None,
                    url="/zgloszenia",
                )
                for r in reqs
            ],
        )
    )

    late = [t for t in open_tasks(db, user) if t.state == "overdue"]
    groups.append(
        _group(
            "tasks",
            "Zaległe zadania z checklist",
            "/zadania",
            [QueueItem(title=t.label, detail=t.employee, url=f"/pracownicy/{t.employee_id}") for t in late],
        )
    )

    perm = [(x, e) for x, e in latest_permits(db, user) if permit_state(x.valid_until) != "valid"]
    groups.append(
        _group(
            "permits",
            "Dokumenty pobytowe i zezwolenia do odnowienia",
            "/dokumenty-pobytowe",
            [
                QueueItem(
                    title=f"{e.last_name} {e.first_name}",
                    detail=f"{KINDS.get(x.kind, x.kind)}, do {x.valid_until:%d.%m.%Y}",
                    url=f"/pracownicy/{e.id}",
                )
                for x, e in sorted(perm, key=lambda p: p[0].valid_until)
            ],
        )
    )

    exp = expiring(db, user)
    groups.append(
        _group(
            "trainings",
            "Szkolenia do odnowienia",
            "/szkolenia",
            [
                QueueItem(
                    title=f"{r.last_name} {r.first_name}",
                    detail=f"{r.name or r.type_name}, do {r.valid_until:%d.%m.%Y}",
                    url=f"/pracownicy/{r.employee_id}",
                )
                for r in exp
            ],
        )
    )

    q = summary(db, user)
    groups.append(
        _group(
            "quality",
            "Braki w danych pracowników",
            "/braki",
            [
                QueueItem(
                    title=f"{r.last_name} {r.first_name}",
                    detail="Brak: " + ", ".join(CHECKS.get(m, m).removeprefix("Brak ") for m in r.missing),
                    url=f"/pracownicy/{r.id}",
                )
                for r in q.rows
            ],
            count=len(q.rows),
        )
    )

    groups = [g for g in groups if g.count > 0]
    return QueueOut(total=sum(g.count for g in groups), groups=groups)


# ---------- „Dziś”: płaska lista spraw (po sprawach albo po osobach) ----------


class CaseOut(BaseModel):
    group: str  # reply | decide | tasks | renew | data
    key: str  # unikalny klucz sprawy
    employee_id: int | None
    name: str
    sub: str | None  # numer karty albo agencja
    what: str
    due: date | None
    overdue: bool
    when: str | None  # krótki opis czasu („od 2 dni”, „termin 05.11”)
    action: str
    url: str
    task_id: int | None = None  # zadanie z checklisty – można odhaczyć od razu


class CasesOut(BaseModel):
    total: int
    cases: list[CaseOut]


def _low(s: str) -> str:
    """Pierwsza litera mała, skróty (PESEL) bez zmian."""
    return s if s[:2].isupper() else s[:1].lower() + s[1:]


def _ago(d: date, today: date) -> str:
    n = (today - d).days
    return "dziś" if n <= 0 else "wczoraj" if n == 1 else f"od {n} dni"


@router.get("/cases", response_model=CasesOut)
def cases(ctx: StaffAuth, db: DbSession) -> CasesOut:
    from app.routers.employees import format_number
    from app.routers.lifecycle import open_tasks
    from app.routers.permits import KINDS, latest_permits, permit_state
    from app.routers.quality import CHECKS, summary
    from app.routers.trainings import expiring

    user, today = ctx.user, date.today()
    out: list[CaseOut] = []
    for t in db.scalars(
        select(HrThread).where(HrThread.status == "new", HrThread.staff_archived_at.is_(None)).order_by(HrThread.updated_at)
    ).unique():
        e, d = t.employee, t.updated_at.date()
        out.append(CaseOut(group="reply", key=f"m{t.id}", employee_id=e.id, name=f"{e.last_name} {e.first_name}",
                           sub=format_number(e.number), what=t.subject, due=d, overdue=(today - d).days >= 2,
                           when=_ago(d, today), action="Odpowiedz", url=f"/wiadomosci?id={t.id}"))
    for r in db.scalars(select(EmployeeRequest).where(EmployeeRequest.status == "pending").order_by(EmployeeRequest.id)).unique():
        start = r.hire_date
        out.append(CaseOut(group="decide", key=f"r{r.id}", employee_id=None, name=f"{r.last_name} {r.first_name}",
                           sub=r.agency.name if r.agency else None,
                           what="Zgłoszenie nowej osoby" + (f" – start {start:%d.%m}" if start else ""),
                           due=start, overdue=False, when=None, action="Sprawdź", url="/zgloszenia"))
    for t in open_tasks(db, user):
        if t.state != "overdue":
            continue
        out.append(CaseOut(group="tasks", key=f"t{t.id}", employee_id=t.employee_id, name=t.employee, sub=t.number,
                           what=("Wdrożenie: " if t.kind == "onboarding" else "Odejście: ") + t.label,
                           due=t.due_date, overdue=True, when=f"termin {t.due_date:%d.%m}" if t.due_date else None,
                           action="Odhacz" if t.can_edit else "Otwórz",
                           url=f"/pracownicy/{t.employee_id}", task_id=t.id if t.can_edit else None))
    for x, e in latest_permits(db, user):
        st = permit_state(x.valid_until)
        if st == "valid":
            continue
        late = x.valid_until < today
        out.append(CaseOut(group="renew", key=f"p{x.id}", employee_id=e.id, name=f"{e.last_name} {e.first_name}",
                           sub=format_number(e.number), what=KINDS.get(x.kind, x.kind) + (" – nieważny" if late else ""),
                           due=x.valid_until, overdue=late, when=f"{'od' if late else 'do'} {x.valid_until:%d.%m}",
                           action="Wpisz nowy", url=f"/pracownicy/{e.id}"))
    for r in expiring(db, user):
        late = r.valid_until < today
        out.append(CaseOut(group="renew", key=f"s{r.training_id}", employee_id=r.employee_id,
                           name=f"{r.last_name} {r.first_name}", sub=r.number,
                           what=f"Szkolenie: {r.name or r.type_name}" + (" – nieważne" if late else ""),
                           due=r.valid_until, overdue=late, when=f"{'od' if late else 'do'} {r.valid_until:%d.%m}",
                           action="Wpisz nowe", url=f"/pracownicy/{r.employee_id}"))
    for r in summary(db, user).rows:
        miss = ", ".join(_low(CHECKS.get(m, m).removeprefix("Brak ")) for m in r.missing)
        out.append(CaseOut(group="data", key=f"q{r.id}", employee_id=r.id, name=f"{r.last_name} {r.first_name}",
                           sub=r.number, what=f"brak: {miss}", due=None, overdue=False, when=None,
                           action="Uzupełnij", url=f"/pracownicy/{r.id}"))
    # w grupie: najpierw przeterminowane i najstarsze
    order = {"reply": 0, "decide": 1, "tasks": 2, "renew": 3, "data": 4}
    out.sort(key=lambda c: (order[c.group], not c.overdue, c.due or date.max))
    return CasesOut(total=len(out), cases=out)
