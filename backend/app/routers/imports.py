"""Import pracowników z pliku (Administrator, Kadry).

Przebieg bez stanu po stronie serwera – przeglądarka trzyma plik i wysyła go w każdym kroku:
1. POST /api/import/analyze – nagłówki, przykładowe wiersze, proponowane przypisanie kolumn,
2. POST /api/import/preview – walidacja każdego wiersza (nic nie zapisuje),
3. POST /api/import/commit  – ponowna walidacja i zapis wszystkich poprawnych wierszy w jednej transakcji.
"""

import json
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crypto
from app.audit import audit
from app.config import get_settings
from app.deps import DbSession, StaffAuth
from app.importer import (
    FIELD_KEYS,
    FIELDS,
    ImportFileError,
    PeselError,
    RowResult,
    Table,
    cell_text,
    nationality_iso,
    nice_name,
    parse_date,
    parse_pesel,
    parse_sex,
    read_table,
    split_full_name,
    suggest_mapping,
    template_xlsx,
)
from app.models import Agency, Country, Department, Employee, EmployeeStatus, Position, Sex
from app.pesel import parse
from app.routers.employees import format_number

router = APIRouter(prefix="/api/import", tags=["import"])


class FieldOut(BaseModel):
    key: str
    label: str


class AnalyzeOut(BaseModel):
    file_name: str
    sheet: str | None
    headers: list[str]
    sample: list[list[str | None]]
    total_rows: int
    mapping: dict[str, int]


class RowOut(BaseModel):
    row: int
    status: str
    errors: list[str]
    warnings: list[str]
    name: str | None
    pesel_masked: str | None
    birth_date: date | None
    country: str | None
    agency: str | None
    department: str | None
    position: str | None
    hire_date: date | None


class Summary(BaseModel):
    total: int
    to_import: int
    skipped: int
    errors: int
    new_dictionary_items: dict[str, list[str]]


class PreviewOut(BaseModel):
    summary: Summary
    rows: list[RowOut]


class CommitOut(BaseModel):
    imported: int
    skipped: int
    errors: int
    first_number: str | None
    last_number: str | None


# ---------- pomocnicze ----------


async def _load(file: UploadFile) -> tuple[Table, str]:
    limit = get_settings().photo_max_upload_mb * 1024 * 1024
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik jest za duży.")
    name = file.filename or "plik"
    try:
        return read_table(raw, name), name
    except ImportFileError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _parse_mapping(raw: str, width: int) -> dict[str, int]:
    try:
        data = json.loads(raw)
        mapping = {str(k): int(v) for k, v in data.items() if v is not None}
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowe przypisanie kolumn.") from exc
    unknown = set(mapping) - FIELD_KEYS
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Nieznane pola: {sorted(unknown)}")
    if any(not 0 <= i < width for i in mapping.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Przypisanie wskazuje nieistniejącą kolumnę.")
    if len(set(mapping.values())) != len(mapping):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Jedna kolumna jest przypisana do kilku pól.")
    has_names = ("last_name" in mapping and "first_name" in mapping) or "full_name" in mapping
    if not has_names:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Przypisz kolumny z nazwiskiem i imieniem (osobno albo w jednej kolumnie).",
        )
    return mapping


def _key(v: str) -> str:
    return " ".join(v.lower().split())


class Dictionaries:
    """Słowniki wczytane raz na cały import; brakujące pozycje zbierane do ewentualnego dodania."""

    def __init__(self, db: Session, create_missing: bool):
        self.create_missing = create_missing
        self.agencies: dict[str, Agency] = {}
        for a in db.scalars(select(Agency)):
            self.agencies[_key(a.name)] = a
            if a.code:
                self.agencies.setdefault(_key(a.code), a)
        self.departments: dict[str, Department] = {}
        for d in db.scalars(select(Department)):
            self.departments[_key(d.name)] = d
            if d.code:
                self.departments.setdefault(_key(d.code), d)
        self.positions: list[Position] = list(db.scalars(select(Position)))
        self.countries_by_name = {_key(c.name): c for c in db.scalars(select(Country))}
        self.countries_by_iso = {c.iso_code: c for c in self.countries_by_name.values() if c.iso_code}
        self.new_agencies: dict[str, str] = {}
        self.new_departments: dict[str, str] = {}
        self.new_positions: dict[tuple[str, str | None], str] = {}

    def _org(self, value: str, known: dict, new: dict, label: str, r: RowResult) -> str | None:
        k = _key(value)
        obj = known.get(k)
        if obj is not None:
            if not obj.is_active:
                r.errors.append(f"{label} „{obj.name}” jest wyłączone w słowniku")
            return obj.name
        if self.create_missing:
            new.setdefault(k, value)
            return new[k]
        r.errors.append(f"{label} „{value}” nie istnieje w słowniku")
        return None

    def agency(self, v: str, r: RowResult) -> str | None:
        return self._org(v, self.agencies, self.new_agencies, "APT", r)

    def department(self, v: str, r: RowResult) -> str | None:
        return self._org(v, self.departments, self.new_departments, "Wydział", r)

    def position(self, v: str, department: str | None, r: RowResult) -> str | None:
        k = _key(v)
        dep_obj = self.departments.get(_key(department)) if department else None
        candidates = [p for p in self.positions if _key(p.name) == k]
        match = next((p for p in candidates if dep_obj and p.department_id == dep_obj.id), None)
        match = match or next((p for p in candidates if p.department_id is None), None)
        if match is None and candidates and not department:
            match = candidates[0]
        if match is not None:
            if not match.is_active:
                r.errors.append(f"Stanowisko „{match.name}” jest wyłączone w słowniku")
            return match.name
        if candidates and department:
            if not self.create_missing:
                r.errors.append(f"Stanowisko „{v}” nie należy do wydziału „{department}”")
                return None
        if self.create_missing:
            dep_key = _key(department) if department else None
            self.new_positions.setdefault((k, dep_key), v)
            return v
        r.errors.append(f"Stanowisko „{v}” nie istnieje w słowniku")
        return None

    def country(self, v: str, r: RowResult) -> Country | None:
        c = self.countries_by_name.get(_key(v))
        if c is None:
            iso = nationality_iso(v)
            c = self.countries_by_iso.get(iso) if iso else None
        if c is None:
            r.errors.append(f"Nie rozpoznano obywatelstwa „{v}” (dodaj kraj w słowniku)")
        elif not c.is_active:
            r.errors.append(f"Kraj „{c.name}” jest wyłączony w słowniku")
        return c

    def summary(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        if self.new_agencies:
            out["agencies"] = sorted(self.new_agencies.values())
        if self.new_departments:
            out["departments"] = sorted(self.new_departments.values())
        if self.new_positions:
            out["positions"] = sorted(set(self.new_positions.values()))
        return out


def _validate(db: Session, table: Table, mapping: dict[str, int], dicts: Dictionaries) -> list[RowResult]:
    existing_hashes = set(db.scalars(select(Employee.pesel_hash).where(Employee.pesel_hash.is_not(None))))
    existing_people = {
        (_key(f), _key(last), b)
        for f, last, b in db.execute(
            select(Employee.first_name, Employee.last_name, Employee.birth_date).where(
                Employee.birth_date.is_not(None)
            )
        )
    }
    seen_hashes: dict[str, int] = {}
    seen_people: dict[tuple, int] = {}
    results: list[RowResult] = []

    for row_no, row in zip(table.row_numbers, table.rows, strict=True):
        r = RowResult(row=row_no)

        def get(key: str, row: list[Any] = row) -> Any:
            return row[mapping[key]] if key in mapping else None

        v = r.values

        # Nazwisko i imię
        last, first = cell_text(get("last_name")), cell_text(get("first_name"))
        if (not last or not first) and cell_text(get("full_name")):
            try:
                last, first = split_full_name(get("full_name"))
            except ValueError as exc:
                r.errors.append(str(exc))
        if not last or not first:
            if not r.errors:
                r.errors.append("brak nazwiska lub imienia")
        else:
            v["last_name"], v["first_name"] = nice_name(last)[:100], nice_name(first)[:100]

        # Daty i płeć
        for key, label in (("birth_date", "data urodzenia"), ("hire_date", "data zatrudnienia")):
            if cell_text(get(key)):
                try:
                    v[key] = parse_date(get(key))
                except ValueError as exc:
                    r.errors.append(f"{label}: {exc}")
        if v.get("birth_date") and not date(1900, 1, 1) <= v["birth_date"] <= date.today():
            r.errors.append("data urodzenia poza zakresem")
        if cell_text(get("sex")):
            try:
                v["sex"] = parse_sex(get("sex"))
            except ValueError as exc:
                r.errors.append(str(exc))

        # PESEL
        if cell_text(get("pesel")):
            try:
                pesel = parse_pesel(get("pesel"))
                info = parse(pesel)
                if v.get("birth_date") and v["birth_date"] != info.birth_date:
                    r.errors.append("data urodzenia nie zgadza się z PESEL")
                if v.get("sex") and v["sex"] != info.sex:
                    r.errors.append("płeć nie zgadza się z PESEL")
                v["pesel"] = pesel
                v["birth_date"] = info.birth_date
                v["sex"] = info.sex
            except PeselError as exc:
                r.errors.append(f"PESEL: {exc}")

        # Słowniki
        if cell_text(get("country")):
            c = dicts.country(cell_text(get("country")), r)
            if c is not None:
                v["country"] = c.name
        if cell_text(get("agency")):
            v["agency"] = dicts.agency(cell_text(get("agency")), r)
        if cell_text(get("department")):
            v["department"] = dicts.department(cell_text(get("department")), r)
        if cell_text(get("position")):
            v["position"] = dicts.position(cell_text(get("position")), v.get("department"), r)
        if cell_text(get("notes")):
            v["notes"] = str(get("notes")).strip()[:2000]

        # Duplikaty
        if not r.errors:
            if v.get("pesel"):
                h = crypto.blind_index(v["pesel"])
                v["_hash"] = h
                if h in existing_hashes:
                    r.status = "skip"
                    r.warnings.append("osoba z tym PESEL jest już w kartotece – pominięta")
                elif h in seen_hashes:
                    r.errors.append(f"ten sam PESEL co w wierszu {seen_hashes[h]}")
                else:
                    seen_hashes[h] = row_no
            person = (_key(v["first_name"]), _key(v["last_name"]), v.get("birth_date"))
            if r.status == "ok" and not r.errors and v.get("birth_date"):
                if person in existing_people and not v.get("pesel"):
                    r.status = "skip"
                    r.warnings.append(
                        "w kartotece jest osoba o tym samym imieniu, nazwisku i dacie urodzenia – pominięta"
                    )
                elif person in seen_people:
                    r.status = "skip"
                    r.warnings.append(f"powtórzenie wiersza {seen_people[person]} – pominięty")
                else:
                    seen_people[person] = row_no
        if r.errors:
            r.status = "error"
        results.append(r)
    return results


def _row_out(r: RowResult) -> RowOut:
    v = r.values
    name = f"{v['last_name']} {v['first_name']}" if v.get("last_name") else None
    return RowOut(
        row=r.row,
        status=r.status,
        errors=r.errors,
        warnings=r.warnings,
        name=name,
        pesel_masked=("•" * 9 + v["pesel"][-2:]) if v.get("pesel") else None,
        birth_date=v.get("birth_date"),
        country=v.get("country"),
        agency=v.get("agency"),
        department=v.get("department"),
        position=v.get("position"),
        hire_date=v.get("hire_date"),
    )


def _summary(results: list[RowResult], dicts: Dictionaries) -> Summary:
    return Summary(
        total=len(results),
        to_import=sum(r.status == "ok" for r in results),
        skipped=sum(r.status == "skip" for r in results),
        errors=sum(r.status == "error" for r in results),
        new_dictionary_items=dicts.summary(),
    )


# ---------- endpointy ----------


@router.get("/fields", response_model=list[FieldOut])
def fields(ctx: StaffAuth) -> list[FieldOut]:
    return [FieldOut(key=f.key, label=f.label) for f in FIELDS]


@router.get("/template")
def template(ctx: StaffAuth) -> Response:
    return Response(
        template_xlsx(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="import_pracownikow_szablon.xlsx"'},
    )


@router.post("/analyze", response_model=AnalyzeOut)
async def analyze(ctx: StaffAuth, file: Annotated[UploadFile, File()]) -> AnalyzeOut:
    table, name = await _load(file)
    return AnalyzeOut(
        file_name=name,
        sheet=table.sheet,
        headers=[h or f"(kolumna {i + 1})" for i, h in enumerate(table.headers)],
        sample=[[cell_text(c) for c in row] for row in table.rows[:5]],
        total_rows=len(table.rows),
        mapping=suggest_mapping(table.headers),
    )


@router.post("/preview", response_model=PreviewOut)
async def preview(
    ctx: StaffAuth,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    mapping: Annotated[str, Form()],
    create_missing: Annotated[bool, Form()] = False,
) -> PreviewOut:
    table, _ = await _load(file)
    m = _parse_mapping(mapping, len(table.headers))
    dicts = Dictionaries(db, create_missing)
    results = _validate(db, table, m, dicts)
    return PreviewOut(summary=_summary(results, dicts), rows=[_row_out(r) for r in results])


@router.post("/commit", response_model=CommitOut)
async def commit(
    ctx: StaffAuth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    mapping: Annotated[str, Form()],
    create_missing: Annotated[bool, Form()] = False,
    skip_errors: Annotated[bool, Form()] = False,
) -> CommitOut:
    table, file_name = await _load(file)
    m = _parse_mapping(mapping, len(table.headers))
    dicts = Dictionaries(db, create_missing)
    results = _validate(db, table, m, dicts)
    summary = _summary(results, dicts)
    if summary.errors and not skip_errors:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"W pliku jest {summary.errors} wierszy z błędami. Popraw je albo pomiń.",
        )
    to_import = [r for r in results if r.status == "ok"]
    if not to_import:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Brak wierszy do zaimportowania.")

    # Nowe pozycje słowników – tylko te faktycznie używane przez importowane wiersze.
    used = {k: {_key(r.values[k]) for r in to_import if r.values.get(k)} for k in ("agency", "department")}
    for k, name in dicts.new_agencies.items():
        if k in used["agency"]:
            a = Agency(name=name, is_active=True)
            db.add(a)
            dicts.agencies[k] = a
    for k, name in dicts.new_departments.items():
        if k in used["department"]:
            d = Department(name=name, is_active=True)
            db.add(d)
            dicts.departments[k] = d
    db.flush()
    for (k, dep_key), name in dicts.new_positions.items():
        if any(
            r.values.get("position")
            and _key(r.values["position"]) == k
            and (_key(r.values["department"]) if r.values.get("department") else None) == dep_key
            for r in to_import
        ):
            dep = dicts.departments.get(dep_key) if dep_key else None
            p = Position(name=name, department_id=dep.id if dep else None, is_active=True)
            db.add(p)
            dicts.positions.append(p)
    db.flush()

    countries = dicts.countries_by_name
    numbers: list[int] = []
    for r in to_import:
        v = r.values
        dep = dicts.departments.get(_key(v["department"])) if v.get("department") else None
        pos = None
        if v.get("position"):
            cands = [p for p in dicts.positions if _key(p.name) == _key(v["position"])]
            pos = (
                next((p for p in cands if dep and p.department_id == dep.id), None)
                or next((p for p in cands if p.department_id is None), None)
                or (cands[0] if cands and not dep else None)
            )
        e = Employee(
            first_name=v["first_name"],
            last_name=v["last_name"],
            sex=Sex(v["sex"]) if v.get("sex") else None,
            birth_date=v.get("birth_date"),
            country_id=countries[_key(v["country"])].id if v.get("country") else None,
            agency_id=dicts.agencies[_key(v["agency"])].id if v.get("agency") else None,
            department_id=dep.id if dep else None,
            position_id=pos.id if pos else None,
            hire_date=v.get("hire_date"),
            notes=v.get("notes"),
            status=EmployeeStatus.active,
        )
        if v.get("pesel"):
            e.pesel_enc = crypto.encrypt(v["pesel"])
            e.pesel_hash = v["_hash"]
            e.pesel_last2 = v["pesel"][-2:]
        db.add(e)
        db.flush()
        numbers.append(e.number)
        audit(
            db,
            request,
            "employee_created",
            user=ctx.user,
            entity_type="employee",
            entity_id=e.id,
            details={"number": format_number(e.number), "source": "import", "row": r.row},
        )

    audit(
        db,
        request,
        "import_completed",
        user=ctx.user,
        entity_type="import",
        details={
            "file": file_name[:200],
            "imported": len(to_import),
            "skipped": summary.skipped,
            "errors_skipped": summary.errors,
            "new_dictionary_items": {k: len(v) for k, v in dicts.summary().items()},
        },
    )
    db.commit()
    return CommitOut(
        imported=len(to_import),
        skipped=summary.skipped,
        errors=summary.errors,
        first_number=format_number(min(numbers)) if numbers else None,
        last_number=format_number(max(numbers)) if numbers else None,
    )
