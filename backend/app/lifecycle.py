"""Cykl życia pracownika: historia przydziałów i checklisty wdrożenia / odejścia."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    Agency,
    Assignment,
    AuditLog,
    ChecklistItem,
    ChecklistTemplateItem,
    Department,
    DocumentSignature,
    Employee,
    GeneratedDocument,
    PlannedChange,
    Position,
    Training,
)

ASSIGNMENT_FIELDS = {"agency_id", "department_id", "position_id"}
KINDS = {"onboarding": "Wdrożenie", "offboarding": "Odejście"}


def _name(db: Session, model: type, ref: int | None) -> str | None:
    obj = db.get(model, ref) if ref else None
    return obj.name if obj else None


def record_assignment(
    db: Session, e: Employee, valid_from: date, reason: str, user_name: str | None
) -> Assignment:
    a = Assignment(
        employee_id=e.id,
        valid_from=valid_from,
        agency_name=_name(db, Agency, e.agency_id),
        department_name=_name(db, Department, e.department_id),
        position_name=_name(db, Position, e.position_id),
        reason=reason,
        changed_by_name=user_name,
    )
    db.add(a)
    return a


def check_effective_date(db: Session, e: Employee, effective: date) -> None:
    """Data zmiany przydziału: nie w przyszłości, nie przed zatrudnieniem ani przed poprzednią zmianą."""
    from fastapi import HTTPException, status

    if e.hire_date and effective < e.hire_date:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Data zmiany jest wcześniejsza niż data zatrudnienia ({e.hire_date:%d.%m.%Y}).",
        )
    last = db.scalar(select(func.max(Assignment.valid_from)).where(Assignment.employee_id == e.id))
    pending = db.scalar(
        select(func.max(PlannedChange.effective_date)).where(
            PlannedChange.employee_id == e.id,
            PlannedChange.applied_at.is_(None),
            PlannedChange.cancelled_at.is_(None),
        )
    )
    if pending and effective <= pending:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Jest już zaplanowana zmiana na {pending:%d.%m.%Y} – nowa musi być późniejsza "
            "albo anuluj tamtą.",
        )
    if last and effective < last:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Data zmiany jest wcześniejsza niż poprzednia zmiana ({last:%d.%m.%Y}).",
        )


def after_update(
    db: Session, e: Employee, changes: dict[str, Any], user_name: str | None, effective: date | None = None
) -> None:
    if ASSIGNMENT_FIELDS & changes.keys():
        db.flush()
        record_assignment(db, e, effective or date.today(), "zmiana", user_name)
    if {"agency_id", "department_id", "hire_date"} & changes.keys():
        sync_checklist(db, e, "onboarding")


# ---------- checklisty ----------


def applies(t: ChecklistTemplateItem, e: Employee) -> bool:
    """Czy pozycja szablonu dotyczy osoby (APT i wydział; pusta lista = wszyscy)."""
    return (not t.agency_ids or e.agency_id in t.agency_ids) and (
        not t.department_ids or e.department_id in t.department_ids
    )


def _templates_for(db: Session, kind: str, e: Employee) -> list[ChecklistTemplateItem]:
    tpl = db.scalars(
        select(ChecklistTemplateItem)
        .where(ChecklistTemplateItem.kind == kind, ChecklistTemplateItem.is_active)
        .order_by(ChecklistTemplateItem.sort, ChecklistTemplateItem.id)
    )
    return [t for t in tpl if applies(t, e)]


def _from_template(e: Employee, kind: str, t: ChecklistTemplateItem, base: date) -> ChecklistItem:
    return ChecklistItem(
        employee_id=e.id,
        kind=kind,
        template_item_id=t.id,
        label=t.label,
        responsible=t.responsible,
        due_date=base + timedelta(days=t.due_days),
        auto=t.auto,
        sort=t.sort,
    )


def create_checklist(db: Session, e: Employee, kind: str, base: date | None) -> list[ChecklistItem]:
    """Nowa checklista z aktywnego szablonu (poprzednia tego rodzaju jest zastępowana)."""
    db.execute(delete(ChecklistItem).where(ChecklistItem.employee_id == e.id, ChecklistItem.kind == kind))
    base = base or date.today()
    items = [_from_template(e, kind, t, base) for t in _templates_for(db, kind, e)]
    db.add_all(items)
    return items


def sync_checklist(db: Session, e: Employee, kind: str) -> tuple[int, int]:
    """Dopasowuje istniejącą checklistę do szablonu i przydziału osoby.

    Dodaje brakujące pozycje, usuwa nietknięte pozycje, które przestały dotyczyć osoby,
    aktualizuje nazwę / odpowiedzialnego / termin pozycji nieodhaczonych. Zwraca (dodane, usunięte).
    """
    items = list(
        db.scalars(select(ChecklistItem).where(ChecklistItem.employee_id == e.id, ChecklistItem.kind == kind))
    )
    if not items:
        return 0, 0
    base = (e.hire_date if kind == "onboarding" else e.termination_date) or min(
        (i.created_at.date() for i in items if i.created_at), default=date.today()
    )
    wanted = {t.id: t for t in _templates_for(db, kind, e)}
    have = {i.template_item_id: i for i in items if i.template_item_id}
    added = removed = 0
    for i in items:
        untouched = i.done_at is None and not i.skipped and not i.note
        if i.template_item_id and i.template_item_id not in wanted and untouched:
            db.delete(i)
            removed += 1
        elif i.template_item_id in wanted and i.done_at is None:
            t = wanted[i.template_item_id]
            i.label, i.responsible, i.auto, i.sort = t.label, t.responsible, t.auto, t.sort
            i.due_date = base + timedelta(days=t.due_days)
    for tid, t in wanted.items():
        if tid not in have:
            db.add(_from_template(e, kind, t, base))
            added += 1
    return added, removed


ONBOARDING_BACKDATE_DAYS = 14


def maybe_onboarding(db: Session, e: Employee) -> None:
    """Checklista wdrożenia dla nowych osób – nie dla wpisywanych wstecz (np. import starej kartoteki)."""
    if e.hire_date is None or e.hire_date >= date.today() - timedelta(days=ONBOARDING_BACKDATE_DAYS):
        create_checklist(db, e, "onboarding", e.hire_date)


def auto_done(db: Session, it: ChecklistItem, e: Employee) -> bool:
    """Czy pozycja jest spełniona automatycznie (zdjęcie, karta, szkolenie, dokument, podpis dokumentu)."""
    if not it.auto:
        return False
    since = (it.created_at or datetime.now(UTC)) - timedelta(days=60)
    if it.auto == "photo":
        return e.photo is not None
    if it.auto == "card":
        q = select(AuditLog.id).where(
            AuditLog.action == "card_printed",
            AuditLog.entity_type == "employee",
            AuditLog.entity_id == str(e.id),
            AuditLog.ts >= since,
        )
        return db.scalar(q.limit(1)) is not None
    kind, _, ref = it.auto.partition(":")
    if not ref.isdigit():
        return False
    if kind == "training":
        q = select(Training.id).where(Training.employee_id == e.id, Training.type_id == int(ref))
        return db.scalar(q.limit(1)) is not None
    if kind == "document":
        q = select(GeneratedDocument.id).where(
            GeneratedDocument.employee_id == e.id,
            GeneratedDocument.template_id == int(ref),
            GeneratedDocument.deleted_at.is_(None),
            GeneratedDocument.created_at >= since,
        )
        return db.scalar(q.limit(1)) is not None
    if kind == "signed":
        # pracownik podpisał (na ekranie / podpisem zaufanym) albo dołączono skan podpisanego papieru
        q = (
            select(DocumentSignature.id)
            .join(GeneratedDocument, GeneratedDocument.id == DocumentSignature.document_id)
            .where(
                GeneratedDocument.employee_id == e.id,
                GeneratedDocument.template_id == int(ref),
                GeneratedDocument.deleted_at.is_(None),
                DocumentSignature.status == "signed",
                DocumentSignature.role.in_(("pracownika", "skan")),
            )
        )
        return db.scalar(q.limit(1)) is not None
    return False


def item_state(db: Session, it: ChecklistItem, e: Employee, today: date | None = None) -> str:
    """done | auto | skipped | overdue | open"""
    today = today or date.today()
    if it.done_at:
        return "done"
    if it.skipped:
        return "skipped"
    if auto_done(db, it, e):
        return "auto"
    if it.due_date and it.due_date < today:
        return "overdue"
    return "open"


OPEN_STATES = {"open", "overdue"}


# ---------- zaplanowane zmiany ----------


def plan_change(
    db: Session, e: Employee, effective: date, data: dict[str, Any], user_name: str | None
) -> PlannedChange:
    pc = PlannedChange(employee_id=e.id, effective_date=effective, changes=data, created_by_name=user_name)
    db.add(pc)
    return pc


def apply_change(db: Session, pc: PlannedChange) -> bool:
    """Wprowadza zaplanowaną zmianę (pomija osoby z archiwum – zmiana zostaje anulowana)."""
    e = db.get(Employee, pc.employee_id)
    now = datetime.now(UTC)
    if e is None or e.status.value != "active":
        pc.cancelled_at = now
        return False
    for field, value in pc.changes.items():
        if field in ASSIGNMENT_FIELDS:
            setattr(e, field, value)
    db.flush()
    db.refresh(e)
    record_assignment(db, e, pc.effective_date, "zaplanowana zmiana", pc.created_by_name)
    sync_checklist(db, e, "onboarding")
    pc.applied_at = now
    return True


def apply_due_changes(db: Session, today: date | None = None) -> int:
    from app.audit import audit

    today = today or date.today()
    due = db.scalars(
        select(PlannedChange)
        .where(
            PlannedChange.effective_date <= today,
            PlannedChange.applied_at.is_(None),
            PlannedChange.cancelled_at.is_(None),
        )
        .order_by(PlannedChange.effective_date, PlannedChange.id)
    )
    n = 0
    for pc in list(due):
        if apply_change(db, pc):
            n += 1
            details = {"effective_date": pc.effective_date.isoformat(), "changes": pc.changes}
            audit(
                db,
                None,
                "planned_change_applied",
                entity_type="employee",
                entity_id=pc.employee_id,
                details=details,
            )
    db.commit()
    return n


def cancel_pending(db: Session, e: Employee) -> None:
    for pc in db.scalars(
        select(PlannedChange).where(
            PlannedChange.employee_id == e.id,
            PlannedChange.applied_at.is_(None),
            PlannedChange.cancelled_at.is_(None),
        )
    ):
        pc.cancelled_at = datetime.now(UTC)
