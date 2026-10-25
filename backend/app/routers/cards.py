"""Druk kart identyfikacyjnych (PDF). Administrator, Kadry i Kierownik (w swoim zakresie)."""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import cards, photos
from app.audit import audit
from app.deps import AuthContext, DbSession, require_roles
from app.models import Employee, Role
from app.routers.employees import apply_scope, format_number

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
    )


@router.post("/pdf")
def pdf(body: CardsIn, ctx: PrintAuth, request: Request, db: DbSession) -> Response:
    emps = _load(db, ctx.user, body.employee_ids)
    data = [
        cards.CardData(
            number=format_number(e.number),
            first_name=e.first_name,
            last_name=e.last_name,
            agency=e.agency.name if e.agency else None,
            department=e.department.name if e.department else None,
            photo=photos.path_for(e.photo.file_name) if e.photo else None,
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
            details={"number": format_number(e.number), "layout": body.layout},
        )
    db.commit()
    name = f"karta_{numbers[0]}.pdf" if len(numbers) == 1 else f"karty_{len(numbers)}.pdf"
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{name}"', "Cache-Control": "no-store"},
    )
