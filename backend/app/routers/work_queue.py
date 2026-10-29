"""Kolejka pracy kadr: jedna lista rzeczy do zrobienia z wielu miejsc aplikacji."""

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
    from app.routers.quality import summary
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
                    detail=", ".join(r.missing),
                    url=f"/pracownicy/{r.id}",
                )
                for r in q.rows
            ],
            count=len(q.rows),
        )
    )

    groups = [g for g in groups if g.count > 0]
    return QueueOut(total=sum(g.count for g in groups), groups=groups)
