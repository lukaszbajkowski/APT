"""Słowniki: APT, wydziały, stanowiska, kraje.

Odczyt: każdy zalogowany. Dodawanie i edycja: Administrator i Kadry.
Pozycji słownika nie usuwamy (mogą być przypisane do pracowników) – wyłączamy je.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import audit
from app.deps import Auth, DbSession, StaffAuth
from app.models import Agency, Country, Department, Position
from app.schemas import DictionaryItemOut

router = APIRouter(prefix="/api", tags=["dictionaries"])


def _strip(v: Any) -> Any:
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class OrgUnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=32)

    _s = field_validator("name", "code", mode="before")(classmethod(lambda cls, v: _strip(v)))


class OrgUnitPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None

    _s = field_validator("name", "code", mode="before")(classmethod(lambda cls, v: _strip(v)))


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    department_id: int | None
    is_active: bool


class PositionIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    department_id: int | None = None

    _s = field_validator("name", mode="before")(classmethod(lambda cls, v: _strip(v)))


class PositionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    department_id: int | None = None
    is_active: bool | None = None

    _s = field_validator("name", mode="before")(classmethod(lambda cls, v: _strip(v)))


class CountryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    iso_code: str | None
    is_active: bool


class CountryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    iso_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")

    @field_validator("name", "iso_code", mode="before")
    @classmethod
    def _norm(cls, v: Any) -> Any:
        v = _strip(v)
        return v.upper() if isinstance(v, str) and len(v) == 2 else v


class CountryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    iso_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    is_active: bool | None = None

    @field_validator("name", "iso_code", mode="before")
    @classmethod
    def _norm(cls, v: Any) -> Any:
        v = _strip(v)
        return v.upper() if isinstance(v, str) and len(v) == 2 else v


def _commit_unique(db: Session, what: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"{what} o takiej nazwie lub skrócie już istnieje."
        ) from exc


def _get(db: Session, model: type, item_id: int, what: str) -> Any:
    obj = db.get(model, item_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Nie znaleziono: {what}.")
    return obj


def _apply(obj: Any, body: BaseModel) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    for field in body.model_fields_set:
        new = getattr(body, field)
        if field in ("name", "is_active") and new is None:
            continue
        old = getattr(obj, field)
        if old != new:
            changes[field] = {"from": old, "to": new}
            setattr(obj, field, new)
    return changes


def _org_unit_routes(model: type, path: str, entity: str, what: str) -> None:
    @router.get(f"/{path}", response_model=list[DictionaryItemOut], name=f"list_{path}")
    def list_items(ctx: Auth, db: DbSession, active_only: bool = False) -> list[Any]:
        q = select(model).order_by(func.lower(model.name))
        if active_only:
            q = q.where(model.is_active)
        return list(db.scalars(q))

    @router.post(
        f"/{path}",
        response_model=DictionaryItemOut,
        status_code=status.HTTP_201_CREATED,
        name=f"create_{path}",
    )
    def create_item(body: OrgUnitIn, ctx: StaffAuth, request: Request, db: DbSession) -> Any:
        obj = model(name=body.name, code=body.code, is_active=True)
        db.add(obj)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status.HTTP_409_CONFLICT, detail=f"{what} o takiej nazwie lub skrócie już istnieje."
            ) from exc
        audit(
            db,
            request,
            f"{entity}_created",
            user=ctx.user,
            entity_type=entity,
            entity_id=obj.id,
            details={"name": obj.name, "code": obj.code},
        )
        _commit_unique(db, what)
        return obj

    @router.patch(f"/{path}/{{item_id}}", response_model=DictionaryItemOut, name=f"update_{path}")
    def update_item(item_id: int, body: OrgUnitPatch, ctx: StaffAuth, request: Request, db: DbSession) -> Any:
        obj = _get(db, model, item_id, what)
        changes = _apply(obj, body)
        if changes:
            audit(
                db,
                request,
                f"{entity}_updated",
                user=ctx.user,
                entity_type=entity,
                entity_id=obj.id,
                details=changes,
            )
        _commit_unique(db, what)
        db.refresh(obj)
        return obj


_org_unit_routes(Agency, "agencies", "agency", "APT")
_org_unit_routes(Department, "departments", "department", "Wydział")


# ---------- stanowiska ----------


def _check_department(db: Session, department_id: int | None) -> None:
    if department_id is not None and db.get(Department, department_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieznany wydział.")


@router.get("/positions", response_model=list[PositionOut])
def list_positions(
    ctx: Auth, db: DbSession, active_only: bool = False, department_id: int | None = None
) -> list[Position]:
    q = select(Position).order_by(func.lower(Position.name))
    if active_only:
        q = q.where(Position.is_active)
    if department_id is not None:
        q = q.where((Position.department_id == department_id) | Position.department_id.is_(None))
    return list(db.scalars(q))


@router.post("/positions", response_model=PositionOut, status_code=status.HTTP_201_CREATED)
def create_position(body: PositionIn, ctx: StaffAuth, request: Request, db: DbSession) -> Position:
    _check_department(db, body.department_id)
    obj = Position(name=body.name, department_id=body.department_id, is_active=True)
    db.add(obj)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Takie stanowisko w tym wydziale już istnieje."
        ) from exc
    audit(
        db,
        request,
        "position_created",
        user=ctx.user,
        entity_type="position",
        entity_id=obj.id,
        details={"name": obj.name, "department_id": obj.department_id},
    )
    _commit_unique(db, "Stanowisko")
    return obj


@router.patch("/positions/{item_id}", response_model=PositionOut)
def update_position(
    item_id: int, body: PositionPatch, ctx: StaffAuth, request: Request, db: DbSession
) -> Position:
    obj = _get(db, Position, item_id, "stanowisko")
    if "department_id" in body.model_fields_set:
        _check_department(db, body.department_id)
    changes = _apply(obj, body)
    if changes:
        audit(
            db,
            request,
            "position_updated",
            user=ctx.user,
            entity_type="position",
            entity_id=obj.id,
            details=changes,
        )
    _commit_unique(db, "Stanowisko")
    db.refresh(obj)
    return obj


# ---------- kraje ----------


@router.get("/countries", response_model=list[CountryOut])
def list_countries(ctx: Auth, db: DbSession, active_only: bool = False) -> list[Country]:
    # Polska zawsze na górze listy, reszta alfabetycznie.
    q = select(Country).order_by((Country.iso_code != "PL"), func.lower(Country.name))
    if active_only:
        q = q.where(Country.is_active)
    return list(db.scalars(q))


@router.post("/countries", response_model=CountryOut, status_code=status.HTTP_201_CREATED)
def create_country(body: CountryIn, ctx: StaffAuth, request: Request, db: DbSession) -> Country:
    obj = Country(name=body.name, iso_code=body.iso_code, is_active=True)
    db.add(obj)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Kraj o takiej nazwie lub kodzie już istnieje."
        ) from exc
    audit(
        db,
        request,
        "country_created",
        user=ctx.user,
        entity_type="country",
        entity_id=obj.id,
        details={"name": obj.name, "iso_code": obj.iso_code},
    )
    _commit_unique(db, "Kraj")
    return obj


@router.patch("/countries/{item_id}", response_model=CountryOut)
def update_country(
    item_id: int, body: CountryPatch, ctx: StaffAuth, request: Request, db: DbSession
) -> Country:
    obj = _get(db, Country, item_id, "kraj")
    changes = _apply(obj, body)
    if changes:
        audit(
            db,
            request,
            "country_updated",
            user=ctx.user,
            entity_type="country",
            entity_id=obj.id,
            details=changes,
        )
    _commit_unique(db, "Kraj")
    db.refresh(obj)
    return obj
