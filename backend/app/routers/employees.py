"""Kartoteka pracowników.

Uprawnienia (patrz specyfikacja, sekcja „Role i uprawnienia”):
- Administrator, Kadry: wszyscy pracownicy, pełna edycja, odczyt PESEL (logowany).
- Kierownik: tylko pracownicy z przypisanych APT / wydziałów; edycja tylko stanowiska i uwag;
  zamiast daty urodzenia widzi wiek; widzi obywatelstwo; PESEL niedostępny.
- Podgląd: wszyscy, tylko odczyt, jak kierownik bez edycji.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Select, String, and_, cast, false, func, or_, select
from sqlalchemy.orm import Session

from app import cardreg, crypto, photos, retention
from app.audit import audit
from app.config import get_settings
from app.deps import Auth, DbSession, StaffAuth
from app.models import (
    Agency,
    AuditLog,
    Card,
    CardStatus,
    Country,
    Department,
    Employee,
    EmployeeStatus,
    Photo,
    Position,
    Role,
    Sex,
    User,
)
from app.pesel import PeselError, normalize, parse
from app.schemas import AuditOut, Page

router = APIRouter(prefix="/api/employees", tags=["employees"])

FULL_ACCESS = (Role.admin, Role.hr)
# Pola, których zmiany zapisujemy w historii bez wartości (dane osobowe).
PERSONAL_FIELDS = {"first_name", "last_name", "sex", "birth_date", "pesel", "country_id", "notes"}


# ---------- schematy ----------


class Ref(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class EmployeeOut(BaseModel):
    id: int
    number: int
    number_display: str
    first_name: str
    last_name: str
    sex: Sex | None
    birth_date: date | None
    age: int | None
    has_pesel: bool
    pesel_masked: str | None
    country: Ref | None
    agency: Ref | None
    department: Ref | None
    position: Ref | None
    hire_date: date | None
    termination_date: date | None
    status: EmployeeStatus
    notes: str | None
    has_photo: bool
    photo_version: str | None
    personal_data_visible: bool
    retention_until: date | None = None
    retention_hold_until: date | None = None


def _clean_str(v: Any) -> Any:
    if isinstance(v, str):
        v = " ".join(v.split())
        return v or None
    return v


class EmployeeIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    sex: Sex | None = None
    birth_date: date | None = None
    pesel: str | None = None
    country_id: int | None = None
    agency_id: int | None = None
    department_id: int | None = None
    position_id: int | None = None
    hire_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    confirm_duplicate: bool = False

    @field_validator("first_name", "last_name", "pesel", mode="before")
    @classmethod
    def _clean(cls, v: Any) -> Any:
        return _clean_str(v)

    @field_validator("notes", mode="before")
    @classmethod
    def _clean_notes(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip() or None
        return v


class EmployeePatch(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    sex: Sex | None = None
    birth_date: date | None = None
    pesel: str | None = None
    country_id: int | None = None
    agency_id: int | None = None
    department_id: int | None = None
    position_id: int | None = None
    hire_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    confirm_duplicate: bool = False

    @field_validator("first_name", "last_name", "pesel", mode="before")
    @classmethod
    def _clean(cls, v: Any) -> Any:
        return _clean_str(v)

    @field_validator("notes", mode="before")
    @classmethod
    def _clean_notes(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip() or None
        return v

    @model_validator(mode="after")
    def _names_not_null(self) -> "EmployeePatch":
        for f in ("first_name", "last_name"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"Pole {f} nie może być puste.")
        return self


class TerminateIn(BaseModel):
    termination_date: date


class PeselOut(BaseModel):
    pesel: str


class PeselCheckIn(BaseModel):
    pesel: str


class PeselCheckOut(BaseModel):
    valid: bool
    message: str | None = None
    birth_date: date | None = None
    sex: Sex | None = None
    duplicate_of: dict[str, Any] | None = None


# ---------- pomocnicze ----------


def full_access(user: User) -> bool:
    return user.role in FULL_ACCESS


def format_number(n: int) -> str:
    return f"{n:06d}"


def age_on(born: date | None, today: date) -> int | None:
    if born is None:
        return None
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def to_out(e: Employee, user: User, today: date | None = None) -> EmployeeOut:
    today = today or date.today()
    personal = full_access(user)
    return EmployeeOut(
        id=e.id,
        number=e.number,
        number_display=format_number(e.number),
        first_name=e.first_name,
        last_name=e.last_name,
        sex=e.sex,
        birth_date=e.birth_date if personal else None,
        age=age_on(e.birth_date, today),
        has_pesel=e.pesel_hash is not None,
        pesel_masked=("•" * 9 + (e.pesel_last2 or "")) if personal and e.pesel_hash else None,
        country=Ref.model_validate(e.country) if e.country else None,
        agency=Ref.model_validate(e.agency) if e.agency else None,
        department=Ref.model_validate(e.department) if e.department else None,
        position=Ref.model_validate(e.position) if e.position else None,
        hire_date=e.hire_date,
        termination_date=e.termination_date,
        status=e.status,
        notes=e.notes,
        has_photo=e.photo is not None,
        photo_version=str(e.photo.id) if e.photo else None,
        personal_data_visible=personal,
        retention_until=retention.delete_after(e),
        retention_hold_until=e.retention_hold_until if e.status == EmployeeStatus.terminated else None,
    )


def scope_condition(user: User) -> Any:
    """Warunek SQL ograniczający kierownika do jego APT / wydziałów."""
    if user.role != Role.manager:
        return None
    agency_ids = [s.agency_id for s in user.scopes if s.agency_id is not None]
    department_ids = [s.department_id for s in user.scopes if s.department_id is not None]
    parts = []
    if agency_ids:
        parts.append(Employee.agency_id.in_(agency_ids))
    if department_ids:
        parts.append(Employee.department_id.in_(department_ids))
    return or_(*parts) if parts else false()


def apply_scope(q: Select, user: User) -> Select:
    cond = scope_condition(user)
    return q.where(cond) if cond is not None else q


def get_visible(db: Session, user: User, employee_id: int) -> Employee:
    q = apply_scope(select(Employee).where(Employee.id == employee_id), user)
    e = db.scalar(q)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
    return e


def _conflict(code: str, message: str, existing: Employee | None = None) -> HTTPException:
    detail: dict[str, Any] = {"code": code, "message": message}
    if existing is not None:
        detail["employee"] = {
            "id": existing.id,
            "number": format_number(existing.number),
            "name": f"{existing.last_name} {existing.first_name}",
        }
    return HTTPException(status.HTTP_409_CONFLICT, detail=detail)


def _bad(message: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail=message)


def _check_ref(db: Session, model: type, ref_id: int | None, current: int | None, label: str) -> None:
    """Słownik musi istnieć; nowo przypisywana pozycja musi być aktywna."""
    if ref_id is None:
        return
    obj = db.get(model, ref_id)
    if obj is None:
        raise _bad(f"Nieznana pozycja słownika: {label}.")
    if not obj.is_active and ref_id != current:
        raise _bad(f"Pozycja słownika „{obj.name}” ({label}) jest wyłączona.")


def _validate(db: Session, e: Employee, values: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    """Waliduje i uzupełnia dane. Zwraca słownik pól do ustawienia na encji."""
    out = dict(values)

    if "pesel" in values:
        raw = values["pesel"]
        if raw:
            pesel = normalize(raw)
            try:
                info = parse(pesel)
            except PeselError as exc:
                raise _bad(str(exc)) from exc
            birth = values.get("birth_date") if "birth_date" in values else e.birth_date
            sex = values.get("sex") if "sex" in values else e.sex
            if birth is not None and birth != info.birth_date:
                raise _bad("Data urodzenia nie zgadza się z numerem PESEL.")
            if sex is not None and Sex(sex).value != info.sex:
                raise _bad("Płeć nie zgadza się z numerem PESEL.")
            out["birth_date"] = info.birth_date
            out["sex"] = Sex(info.sex)
            out["pesel"] = pesel
        else:
            out["pesel"] = None
    elif e.pesel_enc is not None and ("birth_date" in values or "sex" in values):
        # Zmiana daty/płci przy istniejącym PESEL – sprawdzamy zgodność.
        info = parse(crypto.decrypt(e.pesel_enc))
        if "birth_date" in values and values["birth_date"] != info.birth_date:
            raise _bad("Data urodzenia nie zgadza się z numerem PESEL.")
        if "sex" in values and values["sex"] is not None and Sex(values["sex"]).value != info.sex:
            raise _bad("Płeć nie zgadza się z numerem PESEL.")

    born = out.get("birth_date", e.birth_date)
    if born is not None and (born > date.today() or born.year < 1900):
        raise _bad("Nieprawidłowa data urodzenia.")

    _check_ref(db, Country, values.get("country_id"), None if creating else e.country_id, "kraj")
    _check_ref(db, Agency, values.get("agency_id"), None if creating else e.agency_id, "APT")
    _check_ref(db, Department, values.get("department_id"), None if creating else e.department_id, "wydział")
    _check_ref(db, Position, values.get("position_id"), None if creating else e.position_id, "stanowisko")

    position_id = out.get("position_id", e.position_id)
    department_id = out.get("department_id", e.department_id)
    if position_id is not None and ("position_id" in values or "department_id" in values):
        pos = db.get(Position, position_id)
        if (
            pos
            and pos.department_id is not None
            and department_id is not None
            and (pos.department_id != department_id)
        ):
            raise _bad("Wybrane stanowisko należy do innego wydziału.")

    hire = out.get("hire_date", e.hire_date)
    if hire is not None and e.termination_date is not None and hire > e.termination_date:
        raise _bad("Data zatrudnienia jest późniejsza niż data zwolnienia.")
    return out


def _check_duplicates(db: Session, e: Employee, data: dict[str, Any], confirm: bool) -> str | None:
    """Zwraca skrót PESEL (gdy zmieniany). Rzuca 409 przy duplikatach."""
    pesel_hash = None
    if data.get("pesel"):
        pesel_hash = crypto.blind_index(data["pesel"])
        q = select(Employee).where(Employee.pesel_hash == pesel_hash)
        if e.id is not None:
            q = q.where(Employee.id != e.id)
        existing = db.scalar(q)
        if existing is not None:
            raise _conflict("pesel_duplicate", "Pracownik z tym numerem PESEL już istnieje.", existing)

    if not confirm:
        first = data.get("first_name", e.first_name)
        last = data.get("last_name", e.last_name)
        born = data.get("birth_date", e.birth_date)
        relevant = {"first_name", "last_name", "birth_date", "pesel"} & data.keys()
        if born is not None and relevant:
            q = select(Employee).where(
                func.lower(Employee.first_name) == first.lower(),
                func.lower(Employee.last_name) == last.lower(),
                Employee.birth_date == born,
            )
            if e.id is not None:
                q = q.where(Employee.id != e.id)
            existing = db.scalar(q.limit(1))
            if existing is not None:
                raise _conflict(
                    "possible_duplicate",
                    "Istnieje już pracownik o tym samym imieniu, nazwisku i dacie urodzenia. "
                    "Czy na pewno to inna osoba?",
                    existing,
                )
    return pesel_hash


def _assign(e: Employee, data: dict[str, Any], pesel_hash: str | None) -> dict[str, Any]:
    """Przypisuje pola i zwraca opis zmian do historii (bez wartości danych osobowych)."""
    changes: dict[str, Any] = {}
    for field, new in data.items():
        if field == "pesel":
            if new is None and e.pesel_enc is not None:
                e.pesel_enc = e.pesel_hash = e.pesel_last2 = None
                changes["pesel"] = "usunięty"
            elif new is not None and pesel_hash != e.pesel_hash:
                e.pesel_enc = crypto.encrypt(new)
                e.pesel_hash = pesel_hash
                e.pesel_last2 = new[-2:]
                changes["pesel"] = "zmieniony"
            continue
        old = getattr(e, field)
        if old == new:
            continue
        setattr(e, field, new)
        if field in PERSONAL_FIELDS:
            changes[field] = "zmienione"
        else:
            changes[field] = {"from": _plain(old), "to": _plain(new)}
    return changes


def _plain(v: Any) -> Any:
    if isinstance(v, date):
        return v.isoformat()
    if hasattr(v, "value"):
        return v.value
    return v


# ---------- lista ----------

SortKey = Literal["name", "-name", "number", "-number", "hire_date", "-hire_date"]
CardFilter = Literal["none", "expiring", "expired"]
CARD_EXPIRING_DAYS = 30


def card_condition(kind: str, today: date | None = None) -> Any:
    """Warunek SQL na aktualną kartę pracownika (z rejestru kart)."""
    today = today or date.today()
    active = and_(Card.employee_id == Employee.id, Card.status == CardStatus.active)
    if kind == "none":
        valid = or_(Card.valid_until.is_(None), Card.valid_until >= today)
        return ~select(Card.id).where(active, valid).exists()
    if kind == "expiring":
        window = Card.valid_until.between(today, today + timedelta(days=CARD_EXPIRING_DAYS))
        return select(Card.id).where(active, window).exists()
    return select(Card.id).where(active, Card.valid_until < today).exists()


MissingKey = Literal["photo", "birth_date", "country", "pesel", "agency", "department", "position"]


class ListFilters:
    """Filtry listy pracowników – wspólne dla listy i dla pobrania samych identyfikatorów."""

    def __init__(
        self,
        q: str | None = None,
        agency_id: int | None = None,
        department_id: int | None = None,
        position_id: int | None = None,
        status_: Annotated[Literal["active", "terminated", "all"], Query(alias="status")] = "active",
        missing: Annotated[list[MissingKey] | None, Query()] = None,
        sort: SortKey = "name",
        card: CardFilter | None = None,
    ):
        self.card = card
        self.q, self.agency_id, self.department_id, self.position_id = (
            q,
            agency_id,
            department_id,
            position_id,
        )
        self.status, self.missing, self.sort = status_, missing or [], sort

    def query(self, user: User) -> Select:
        conditions: list[Any] = []
        if self.q and self.q.strip():
            for token in self.q.split():
                like = f"%{token.lower()}%"
                digits = token.lstrip("0") or "0"
                conditions.append(
                    or_(
                        func.lower(Employee.first_name).like(like),
                        func.lower(Employee.last_name).like(like),
                        cast(Employee.number, String) == digits if token.isdigit() else false(),
                    )
                )
        if self.agency_id is not None:
            conditions.append(Employee.agency_id == self.agency_id)
        if self.department_id is not None:
            conditions.append(Employee.department_id == self.department_id)
        if self.position_id is not None:
            conditions.append(Employee.position_id == self.position_id)
        if self.status != "all":
            conditions.append(Employee.status == EmployeeStatus(self.status))
        for m in self.missing:
            if m == "photo":
                conditions.append(~select(Photo.id).where(Photo.employee_id == Employee.id).exists())
            elif m == "pesel":
                conditions.append(Employee.pesel_hash.is_(None))
            elif m == "country":
                conditions.append(Employee.country_id.is_(None))
            else:
                conditions.append(getattr(Employee, f"{m}_id" if m != "birth_date" else m).is_(None))
        if self.card:
            conditions.append(card_condition(self.card))
        base = select(Employee).where(and_(*conditions)) if conditions else select(Employee)
        return apply_scope(base, user)

    def order(self) -> tuple:
        return {
            "name": (func.lower(Employee.last_name), func.lower(Employee.first_name), Employee.number),
            "-name": (func.lower(Employee.last_name).desc(), func.lower(Employee.first_name).desc()),
            "number": (Employee.number,),
            "-number": (Employee.number.desc(),),
            "hire_date": (Employee.hire_date.asc().nulls_last(), Employee.number),
            "-hire_date": (Employee.hire_date.desc().nulls_last(), Employee.number),
        }[self.sort]


Filters = Annotated[ListFilters, Depends()]


@router.get("", response_model=Page[EmployeeOut])
def list_employees(
    ctx: Auth,
    db: DbSession,
    filters: Filters,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[EmployeeOut]:
    base = filters.query(ctx.user)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(*filters.order()).limit(limit).offset(offset)).unique()
    today = date.today()
    return Page[EmployeeOut](
        items=[to_out(e, ctx.user, today) for e in rows], total=total, limit=limit, offset=offset
    )


@router.get("/ids", response_model=list[int])
def list_ids(ctx: Auth, db: DbSession, filters: Filters) -> list[int]:
    """Identyfikatory wszystkich pracowników spełniających filtry (np. „zaznacz wszystkie” do druku)."""
    base = filters.query(ctx.user).with_only_columns(Employee.id)
    return list(db.scalars(base.order_by(*filters.order()).limit(5000)))


# ---------- PESEL: sprawdzenie w formularzu ----------


@router.post("/check-pesel", response_model=PeselCheckOut)
def check_pesel(body: PeselCheckIn, ctx: StaffAuth, db: DbSession, exclude_id: int | None = None) -> Any:
    pesel = normalize(body.pesel)
    try:
        info = parse(pesel)
    except PeselError as exc:
        return PeselCheckOut(valid=False, message=str(exc))
    q = select(Employee).where(Employee.pesel_hash == crypto.blind_index(pesel))
    if exclude_id is not None:
        q = q.where(Employee.id != exclude_id)
    existing = db.scalar(q)
    dup = None
    if existing is not None:
        dup = {
            "id": existing.id,
            "number": format_number(existing.number),
            "name": f"{existing.last_name} {existing.first_name}",
        }
    return PeselCheckOut(valid=True, birth_date=info.birth_date, sex=Sex(info.sex), duplicate_of=dup)


# ---------- jeden pracownik ----------


@router.get("/by-number/{code}", response_model=EmployeeOut)
def get_by_card(code: str, ctx: Auth, request: Request, db: DbSession) -> EmployeeOut:
    """Wyszukanie po numerze ewidencyjnym z karty (kod QR lub wpisany ręcznie)."""
    digits = "".join(ch for ch in code if ch.isdigit())
    if not digits or len(digits) > 9:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="To nie jest numer z karty pracownika.")
    e = db.scalar(apply_scope(select(Employee).where(Employee.number == int(digits)), ctx.user))
    if e is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"Nie znaleziono pracownika o numerze {digits.zfill(6)} (albo nie masz do niego dostępu).",
        )
    audit(
        db,
        request,
        "card_scanned",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number)},
    )
    db.commit()
    return to_out(e, ctx.user)


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, ctx: Auth, db: DbSession) -> EmployeeOut:
    return to_out(get_visible(db, ctx.user, employee_id), ctx.user)


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(body: EmployeeIn, ctx: StaffAuth, request: Request, db: DbSession) -> EmployeeOut:
    values = body.model_dump(exclude={"confirm_duplicate"}, exclude_unset=False)
    if not values.get("pesel"):
        values.pop("pesel", None)
    e = Employee(first_name=body.first_name, last_name=body.last_name, status=EmployeeStatus.active)
    data = _validate(db, e, values, creating=True)
    pesel_hash = _check_duplicates(db, e, data, body.confirm_duplicate)
    _assign(e, data, pesel_hash)
    db.add(e)
    db.flush()
    db.refresh(e)
    audit(
        db,
        request,
        "employee_created",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number)},
    )
    db.commit()
    return to_out(e, ctx.user)


MANAGER_EDITABLE = {"position_id", "notes"}


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int, body: EmployeePatch, ctx: Auth, request: Request, db: DbSession
) -> EmployeeOut:
    user = ctx.user
    if user.role == Role.viewer:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    e = get_visible(db, user, employee_id)
    fields = body.model_fields_set - {"confirm_duplicate"}
    if user.role == Role.manager and not fields <= MANAGER_EDITABLE:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Kierownik może zmieniać tylko stanowisko i uwagi."
        )
    values = {f: getattr(body, f) for f in fields}
    data = _validate(db, e, values, creating=False)
    pesel_hash = _check_duplicates(db, e, data, body.confirm_duplicate)
    changes = _assign(e, data, pesel_hash)
    if changes:
        audit(
            db,
            request,
            "employee_updated",
            user=user,
            entity_type="employee",
            entity_id=e.id,
            details={"number": format_number(e.number), "changes": changes},
        )
    db.commit()
    db.refresh(e)
    return to_out(e, user)


@router.post("/{employee_id}/terminate", response_model=EmployeeOut)
def terminate(
    employee_id: int, body: TerminateIn, ctx: StaffAuth, request: Request, db: DbSession
) -> EmployeeOut:
    e = get_visible(db, ctx.user, employee_id)
    if e.status == EmployeeStatus.terminated:
        raise _bad("Pracownik jest już w archiwum.")
    if e.hire_date and body.termination_date < e.hire_date:
        raise _bad("Data zwolnienia jest wcześniejsza niż data zatrudnienia.")
    e.status = EmployeeStatus.terminated
    e.termination_date = body.termination_date
    current = cardreg.active_card(db, e.id)
    if current is not None:
        cardreg.revoke(current, ctx.user, "termination", None, datetime.now(UTC))
    audit(
        db,
        request,
        "employee_terminated",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "termination_date": body.termination_date.isoformat()},
    )
    db.commit()
    db.refresh(e)
    return to_out(e, ctx.user)


@router.post("/{employee_id}/restore", response_model=EmployeeOut)
def restore(employee_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> EmployeeOut:
    e = get_visible(db, ctx.user, employee_id)
    if e.status == EmployeeStatus.active:
        raise _bad("Pracownik jest aktywny.")
    previous = e.termination_date
    e.status = EmployeeStatus.active
    e.termination_date = None
    e.retention_hold_until = None
    e.retention_hold_reason = None
    audit(
        db,
        request,
        "employee_restored",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "previous_termination_date": _plain(previous)},
    )
    db.commit()
    db.refresh(e)
    return to_out(e, ctx.user)


@router.post("/{employee_id}/pesel", response_model=PeselOut)
def reveal_pesel(employee_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> PeselOut:
    """Pełny PESEL. Każdy odczyt zapisywany w dzienniku zdarzeń."""
    e = get_visible(db, ctx.user, employee_id)
    if e.pesel_enc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pracownik nie ma wpisanego numeru PESEL.")
    pesel = crypto.decrypt(e.pesel_enc)
    audit(
        db,
        request,
        "pesel_viewed",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number)},
    )
    db.commit()
    return PeselOut(pesel=pesel)


@router.get("/{employee_id}/history", response_model=list[AuditOut])
def history(employee_id: int, ctx: StaffAuth, db: DbSession) -> list[AuditOut]:
    get_visible(db, ctx.user, employee_id)
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.entity_type == "employee", AuditLog.entity_id == str(employee_id))
        .order_by(AuditLog.ts.desc(), AuditLog.id.desc())
        .limit(200)
    )
    return [AuditOut.model_validate(r) for r in rows]


# ---------- zdjęcie ----------


@router.get("/{employee_id}/photo")
def get_photo(employee_id: int, ctx: Auth, db: DbSession) -> FileResponse:
    e = get_visible(db, ctx.user, employee_id)
    if e.photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak zdjęcia.")
    path = photos.path_for(e.photo.file_name)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku zdjęcia.")
    return FileResponse(
        path,
        media_type=e.photo.content_type,
        headers={"Cache-Control": "private, max-age=86400", "ETag": str(e.photo.id)},
    )


@router.put("/{employee_id}/photo", response_model=EmployeeOut)
async def upload_photo(
    employee_id: int,
    ctx: StaffAuth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> EmployeeOut:
    e = get_visible(db, ctx.user, employee_id)
    limit = get_settings().photo_max_upload_mb * 1024 * 1024
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Plik jest za duży (maks. {get_settings().photo_max_upload_mb} MB).",
        )
    try:
        processed = photos.process(raw)
    except photos.PhotoError as exc:
        raise _bad(str(exc)) from exc

    file_name = photos.save(e.id, processed)
    old_file = e.photo.file_name if e.photo else None
    if e.photo is not None:
        db.delete(e.photo)
        db.flush()
    e.photo = Photo(
        employee_id=e.id,
        file_name=file_name,
        content_type="image/jpeg",
        size=len(processed.data),
        width=processed.width,
        height=processed.height,
    )
    audit(
        db,
        request,
        "photo_uploaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "size": len(processed.data)},
    )
    db.commit()
    if old_file:
        photos.delete(old_file)
    db.refresh(e)
    return to_out(e, ctx.user)


@router.delete("/{employee_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(employee_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> Response:
    e = get_visible(db, ctx.user, employee_id)
    if e.photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak zdjęcia.")
    old_file = e.photo.file_name
    db.delete(e.photo)
    audit(
        db,
        request,
        "photo_deleted",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number)},
    )
    db.commit()
    photos.delete(old_file)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
