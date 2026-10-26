"""Kompetencje: czy pracownik ma szkolenia wymagane na stanowisku i jaki jest stan danego szkolenia."""

from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee, PositionRequirement, Training

# stan wymagania / komórki matrycy, od najlepszego
OK, EXPIRING, IN_PROGRESS, EXPIRED, MISSING = "ok", "expiring", "in_progress", "expired", "missing"
RANK = {OK: 0, EXPIRING: 1, IN_PROGRESS: 2, EXPIRED: 3, MISSING: 4}
LABELS = {OK: "ma", EXPIRING: "kończy się", IN_PROGRESS: "w trakcie", EXPIRED: "wygasło", MISSING: "brak"}
PROBLEM = {EXPIRED, MISSING}


def _norm(v: str | None) -> str:
    return " ".join((v or "").lower().split())


def training_state(tr: Training, today: date | None = None) -> str:
    from app.routers.trainings import training_status

    st = training_status(tr, today)
    if st in ("valid", "completed", "none"):
        return OK
    if st == "expiring":
        return EXPIRING
    if st in ("planned", "in_progress", "overdue"):
        return IN_PROGRESS
    return EXPIRED


def matches(tr: Training, type_id: int, program_id: int | None, program_name: str | None) -> bool:
    if tr.type_id != type_id:
        return False
    if program_id is None:
        return True
    return tr.program_id == program_id or (tr.program_id is None and _norm(tr.name) == _norm(program_name))


def best_state(trainings: list[Training], type_id: int, program_id: int | None, program_name: str | None,
               today: date | None = None) -> tuple[str, Training | None]:  # fmt: skip
    best, best_tr = MISSING, None
    for tr in trainings:
        if matches(tr, type_id, program_id, program_name):
            st = training_state(tr, today)
            if RANK[st] < RANK[best]:
                best, best_tr = st, tr
    return best, best_tr


def requirement_label(r: PositionRequirement) -> str:
    return r.program.name if r.program else r.type.name


def trainings_by_employee(db: Session, ids: list[int]) -> dict[int, list[Training]]:
    out: dict[int, list[Training]] = defaultdict(list)
    if ids:
        for tr in db.scalars(select(Training).where(Training.employee_id.in_(ids))).unique():
            out[tr.employee_id].append(tr)
    return out


def requirements_by_position(db: Session) -> dict[int, list[PositionRequirement]]:
    out: dict[int, list[PositionRequirement]] = defaultdict(list)
    for r in db.scalars(select(PositionRequirement)).unique():
        out[r.position_id].append(r)
    return out


def employee_requirements(
    e: Employee,
    trainings: list[Training],
    reqs: dict[int, list[PositionRequirement]],
    today: date | None = None,
) -> list[dict[str, Any]]:
    if not e.position_id:
        return []
    out = []
    for r in reqs.get(e.position_id, []):
        st, tr = best_state(trainings, r.type_id, r.program_id, r.program.name if r.program else None, today)
        out.append(
            {"label": requirement_label(r), "state": st, "valid_until": tr.valid_until if tr else None}
        )
    return out
