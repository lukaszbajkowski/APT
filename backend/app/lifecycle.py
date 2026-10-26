"""Cykl życia pracownika: historia przydziałów i checklisty wdrożenia / odejścia."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Agency,
    Assignment,
    AuditLog,
    ChecklistItem,
    ChecklistTemplateItem,
    Department,
    Employee,
    GeneratedDocument,
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


def after_update(db: Session, e: Employee, changes: dict[str, Any], user_name: str | None) -> None:
    if ASSIGNMENT_FIELDS & changes.keys():
        db.flush()
        record_assignment(db, e, date.today(), "zmiana", user_name)
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
    """Czy pozycja jest spełniona automatycznie (zdjęcie, wydruk karty, szkolenie, dokument)."""
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
            GeneratedDocument.created_at >= since,
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
