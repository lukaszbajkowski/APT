"""Druk kart identyfikacyjnych (PDF). Administrator, Kadry i Kierownik (w swoim zakresie)."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import cardreg, cards, photos
from app.audit import audit
from app.deps import Auth, AuthContext, DbSession, require_roles
from app.models import Card, Employee, Role
from app.routers.employees import EmployeeOut, apply_scope, format_number, get_visible, to_out

router = APIRouter(prefix="/api/cards", tags=["cards"])

PrintAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]
MAX_CARDS = 500


class CardsIn(BaseModel):
    employee_ids: list[int] = Field(min_length=1, max_length=MAX_CARDS)
    layout: Literal["a4", "cr80"] = "a4"
    valid_until: date | None = None


class CheckIn(BaseModel):
    employee_ids: list[int] = Field(min_length=1, max_length=MAX_CARDS)


class PersonRef(BaseModel):
    id: int
    number: str
    name: str


class CheckOut(BaseModel):
    count: int
    without_photo: list[PersonRef]
    terminated: list[PersonRef]
    replacing: list[PersonRef]  # mają aktualną kartę – po wydruku stara straci ważność


def _load(db, user, ids: list[int]) -> list[Employee]:
    unique = list(dict.fromkeys(ids))
    found = {
        e.id: e
        for e in db.scalars(apply_scope(select(Employee).where(Employee.id.in_(unique)), user)).unique()
    }
    missing = [i for i in unique if i not in found]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Nie znaleziono pracowników: {missing[:10]}")
    return [found[i] for i in unique]


def _ref(e: Employee) -> PersonRef:
    return PersonRef(id=e.id, number=format_number(e.number), name=f"{e.last_name} {e.first_name}")


@router.post("/check", response_model=CheckOut)
def check(body: CheckIn, ctx: PrintAuth, db: DbSession) -> CheckOut:
    emps = _load(db, ctx.user, body.employee_ids)
    return CheckOut(
        count=len(emps),
        without_photo=[_ref(e) for e in emps if e.photo is None],
        terminated=[_ref(e) for e in emps if e.status.value == "terminated"],
        replacing=[_ref(e) for e in emps if cardreg.active_card(db, e.id) is not None],
    )


@router.post("/pdf")
def pdf(body: CardsIn, ctx: PrintAuth, request: Request, db: DbSession) -> Response:
    emps = _load(db, ctx.user, body.employee_ids)
    now = datetime.now(UTC)
    issued = {e.id: cardreg.issue(db, e, ctx.user, body.layout, body.valid_until, now) for e in emps}
    data = [
        cards.CardData(
            number=format_number(e.number),
            first_name=e.first_name,
            last_name=e.last_name,
            agency=e.agency.name if e.agency else None,
            department=e.department.name if e.department else None,
            photo=photos.path_for(e.photo.file_name) if e.photo else None,
            qr=cardreg.qr_payload(e.number, issued[e.id].version),
        )
        for e in emps
    ]
    content = cards.render(data, body.layout, body.valid_until)
    numbers = [format_number(e.number) for e in emps]
    audit(
        db,
        request,
        "cards_printed",
        user=ctx.user,
        entity_type="card",
        details={
            "count": len(emps),
            "layout": body.layout,
            "valid_until": body.valid_until.isoformat() if body.valid_until else None,
            "numbers": numbers[:100],
        },
    )
    for e in emps:
        audit(
            db,
            request,
            "card_printed",
            user=ctx.user,
            entity_type="employee",
            entity_id=e.id,
            details={
                "number": format_number(e.number),
                "layout": body.layout,
                "card_version": issued[e.id].version,
            },
        )
    db.commit()
    name = f"karta_{numbers[0]}.pdf" if len(numbers) == 1 else f"karty_{len(numbers)}.pdf"
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{name}"', "Cache-Control": "no-store"},
    )


# --- rejestr kart ---------------------------------------------------------------


class CardOut(BaseModel):
    id: int
    version: int
    code: str
    state: cardreg.CardState
    layout: str
    valid_until: date | None
    issued_at: datetime
    issued_by_name: str | None
    closed_at: datetime | None
    revoke_reason: str | None
    revoke_note: str | None


def _card_out(card: Card, number: int) -> CardOut:
    return CardOut(
        id=card.id,
        version=card.version,
        code=cardreg.qr_payload(number, card.version),
        state=cardreg.state(card),
        layout=card.layout,
        valid_until=card.valid_until,
        issued_at=card.issued_at,
        issued_by_name=card.issuer.full_name if card.issuer else None,
        closed_at=card.closed_at,
        revoke_reason=card.revoke_reason,
        revoke_note=card.revoke_note,
    )


@router.get("/employee/{employee_id}", response_model=list[CardOut])
def employee_cards(employee_id: int, ctx: Auth, db: DbSession) -> list[CardOut]:
    e = get_visible(db, ctx.user, employee_id)
    rows = db.scalars(select(Card).where(Card.employee_id == e.id).order_by(Card.version.desc())).unique()
    return [_card_out(c, e.number) for c in rows]


class RevokeIn(BaseModel):
    reason: Literal["lost", "damaged", "other"]
    note: str | None = Field(default=None, max_length=300)


@router.post("/{card_id}/revoke", response_model=CardOut)
def revoke(card_id: int, body: RevokeIn, ctx: PrintAuth, request: Request, db: DbSession) -> CardOut:
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono karty.")
    e = get_visible(db, ctx.user, card.employee_id)
    if cardreg.state(card) in ("revoked", "replaced"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Ta karta już nie jest ważna.")
    cardreg.revoke(card, ctx.user, body.reason, body.note, datetime.now(UTC))
    audit(
        db,
        request,
        "card_revoked",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "card_version": card.version, "reason": body.reason},
    )
    db.commit()
    db.refresh(card)
    return _card_out(card, e.number)


ScanResult = Literal["valid", "replaced", "revoked", "expired", "unknown_card", "legacy", "manual"]


class ScanOut(BaseModel):
    employee: EmployeeOut
    result: ScanResult
    card: CardOut | None
    current_card: CardOut | None


@router.get("/scan/{code}", response_model=ScanOut)
def scan(code: str, ctx: Auth, request: Request, db: DbSession, manual: bool = False) -> ScanOut:
    """Sprawdzenie karty po kodzie QR ('000123-2') albo numerze wpisanym ręcznie."""
    parsed = cardreg.parse_code(code)
    if parsed is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="To nie jest kod karty pracownika.")
    number, version = parsed
    e = db.scalar(apply_scope(select(Employee).where(Employee.number == number), ctx.user))
    if e is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"Nie znaleziono pracownika o numerze {number:06d} (albo nie masz do niego dostępu).",
        )
    current = cardreg.active_card(db, e.id)
    card = None
    if version is None:
        result: ScanResult = "manual" if manual else "legacy"
    else:
        card = db.scalar(select(Card).where(Card.employee_id == e.id, Card.version == version))
        result = cardreg.state(card) if card is not None else "unknown_card"
    audit(
        db,
        request,
        "card_scanned",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "card_version": version, "result": result},
    )
    db.commit()
    return ScanOut(
        employee=to_out(e, ctx.user),
        result=result,
        card=_card_out(card, e.number) if card else None,
        current_card=_card_out(current, e.number) if current else None,
    )
