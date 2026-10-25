"""Rejestr kart: wydawanie, unieważnianie i sprawdzanie kart identyfikacyjnych."""

import re
from datetime import date, datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Card, CardStatus, Employee, User

CardState = Literal["valid", "replaced", "revoked", "expired"]
RevokeReason = Literal["lost", "damaged", "termination", "other"]

REVOKE_LABELS = {
    "lost": "zgubiona",
    "damaged": "zniszczona",
    "termination": "zwolnienie pracownika",
    "other": "inny powód",
}

_CODE = re.compile(r"^\s*0*(\d{1,9})(?:\s*[-/]\s*(\d{1,4}))?\s*$")


def qr_payload(number: int, version: int) -> str:
    """Treść kodu QR na karcie: numer ewidencyjny i wersja karty, np. 000123-2."""
    return f"{number:06d}-{version}"


def parse_code(code: str) -> tuple[int, int | None] | None:
    """'000123-2' -> (123, 2); '000123' (stara karta lub numer wpisany ręcznie) -> (123, None)."""
    m = _CODE.match(code or "")
    if not m:
        return None
    return int(m.group(1)), (int(m.group(2)) if m.group(2) else None)


def state(card: Card, today: date | None = None) -> CardState:
    if card.status == CardStatus.revoked:
        return "revoked"
    if card.status == CardStatus.replaced:
        return "replaced"
    if card.valid_until is not None and (today or date.today()) > card.valid_until:
        return "expired"
    return "valid"


def active_card(db: Session, employee_id: int) -> Card | None:
    return db.scalar(select(Card).where(Card.employee_id == employee_id, Card.status == CardStatus.active))


def issue(db: Session, e: Employee, user: User, layout: str, valid_until: date | None, now: datetime) -> Card:
    """Nowa karta: poprzednia aktywna przestaje być ważna (zastąpiona)."""
    current = active_card(db, e.id)
    if current is not None:
        current.status = CardStatus.replaced
        current.closed_at = now
        current.closed_by = user.id
        db.flush()
    last = db.scalar(select(func.max(Card.version)).where(Card.employee_id == e.id)) or 0
    card = Card(
        employee_id=e.id,
        version=last + 1,
        status=CardStatus.active,
        layout=layout,
        valid_until=valid_until,
        issued_by=user.id,
        issued_at=now,
    )
    db.add(card)
    db.flush()
    return card


def revoke(card: Card, user: User, reason: RevokeReason, note: str | None, now: datetime) -> None:
    card.status = CardStatus.revoked
    card.closed_at = now
    card.closed_by = user.id
    card.revoke_reason = reason
    card.revoke_note = (note or "").strip() or None
