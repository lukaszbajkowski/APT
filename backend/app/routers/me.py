"""„Moje konto” pracownika: własne dane (odczyt), historia zatrudnienia, zdjęcie i kontakt z potwierdzeniem.

Imię, nazwisko, płeć, obywatelstwo, PESEL i daty zmieniają wyłącznie kadry (poza aplikacją, po dokumencie).
Pracownik sam zmienia zdjęcie oraz telefon i e-mail – kontakt zapisuje się dopiero po wpisaniu kodu
wysłanego SMS-em / e-mailem na nowy adres.
"""

import re
import secrets
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import crypto, mailer, photos, sms, storage
from app.audit import audit
from app.deps import Auth, DbSession, utcnow
from app.emails import Email
from app.models import ContactVerification, Employee, Role, User
from app.routers.employees import format_number, store_uploaded_photo
from app.routers.lifecycle import AssignmentOut, PeriodOut, build_timeline
from app.security import token_hash

router = APIRouter(prefix="/api/me", tags=["me"])

CODE_MINUTES = 15
MAX_ATTEMPTS = 5
MAX_SENDS_PER_HOUR = 5
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
Kind = Literal["phone", "email"]


def _me_employee(ctx: Auth, db: DbSession) -> Employee:
    if ctx.user.role != Role.employee or ctx.user.employee_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    e = db.get(Employee, ctx.user.employee_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
    return e


class MyEmployeeOut(BaseModel):
    number: str
    first_name: str
    last_name: str
    sex: str | None
    birth_date: str | None
    pesel_masked: str | None
    country: str | None
    agency: str | None
    department: str | None
    position: str | None
    hire_date: str | None
    termination_date: str | None
    status: str
    has_photo: bool
    photo_version: str | None
    phone: str | None
    phone_verified: bool
    email: str | None
    email_verified: bool
    has_passkey: bool


@router.get("/employee", response_model=MyEmployeeOut)
def my_employee(ctx: Auth, db: DbSession) -> MyEmployeeOut:
    from app.models import WebauthnCredential

    e = _me_employee(ctx, db)

    def dec(blob: bytes | None) -> str | None:
        try:
            return crypto.decrypt_contact(blob) if blob else None
        except ValueError:
            return None

    return MyEmployeeOut(
        number=format_number(e.number),
        first_name=e.first_name,
        last_name=e.last_name,
        sex=e.sex.value if e.sex else None,
        birth_date=e.birth_date.isoformat() if e.birth_date else None,
        pesel_masked=("•" * 9 + (e.pesel_last2 or "")) if e.pesel_hash else None,
        country=e.country.name if e.country else None,
        agency=e.agency.name if e.agency else None,
        department=e.department.name if e.department else None,
        position=e.position.name if e.position else None,
        hire_date=e.hire_date.isoformat() if e.hire_date else None,
        termination_date=e.termination_date.isoformat() if e.termination_date else None,
        status=e.status.value,
        has_photo=e.photo is not None,
        photo_version=str(e.photo.id) if e.photo else None,
        phone=dec(e.phone_enc),
        phone_verified=e.phone_verified_at is not None,
        email=dec(e.email_enc),
        email_verified=e.email_verified_at is not None,
        has_passkey=db.scalar(
            select(WebauthnCredential.id).where(WebauthnCredential.user_id == ctx.user.id).limit(1)
        )
        is not None,
    )


class MyHistoryOut(BaseModel):
    periods: list[PeriodOut]
    assignments: list[AssignmentOut]


@router.get("/history", response_model=MyHistoryOut)
def my_history(ctx: Auth, db: DbSession) -> MyHistoryOut:
    """Zatrudnienie, stanowiska i wydziały – bez powodów zmian i nazwisk osób, które je wpisały."""
    t = build_timeline(db, _me_employee(ctx, db))
    return MyHistoryOut(
        periods=t.periods,
        assignments=[a.model_copy(update={"reason": None, "changed_by": None}) for a in t.assignments],
    )


# --- zdjęcie ------------------------------------------------------------------------------


@router.get("/photo")
def my_photo(ctx: Auth, db: DbSession) -> Response:
    e = _me_employee(ctx, db)
    if e.photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak zdjęcia.")
    path = photos.path_for(e.photo.file_name)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku zdjęcia.")
    return Response(
        storage.read(path),
        media_type=e.photo.content_type,
        headers={"Cache-Control": "private, max-age=86400", "ETag": str(e.photo.id)},
    )


@router.put("/photo", response_model=MyEmployeeOut)
async def upload_my_photo(
    ctx: Auth, request: Request, db: DbSession, file: Annotated[UploadFile, File()]
) -> MyEmployeeOut:
    e = _me_employee(ctx, db)
    await store_uploaded_photo(db, request, ctx.user, e, file)
    return my_employee(ctx, db)


# --- kontakt: telefon i e-mail z potwierdzeniem kodem ------------------------------------------


def _normalize(kind: Kind, raw: str) -> str:
    value = raw.strip()
    if kind == "email":
        if not _EMAIL.match(value) or len(value) > 254:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy adres e-mail.")
        return value.lower()
    try:
        return sms.normalize_phone(value)
    except sms.SmsError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _masked(kind: Kind, value: str) -> str:
    if kind == "email":
        name, _, domain = value.partition("@")
        return f"{name[:1]}***@{domain}"
    return "••• ••• " + value[-3:]


def _code_hash(employee_id: int, kind: str, code: str) -> str:
    return token_hash(f"{employee_id}:{kind}:{code}")


class ContactStartIn(BaseModel):
    value: str = Field(min_length=3, max_length=254)


class ContactStartOut(BaseModel):
    sent_to: str
    expires_minutes: int


def start_contact(
    db: Session, request: Request, e: Employee, kind: Kind, raw_value: str, user: User | None, who: str
) -> ContactStartOut:
    value = _normalize(kind, raw_value)
    now = utcnow()
    sent_last_hour = db.scalar(
        select(func.count())
        .select_from(ContactVerification)
        .where(
            ContactVerification.employee_id == e.id,
            ContactVerification.kind == kind,
            ContactVerification.created_at > now - timedelta(hours=1),
        )
    )
    if (sent_last_hour or 0) >= MAX_SENDS_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Za dużo kodów. Spróbuj ponownie za godzinę."
        )
    if kind == "phone" and not sms.enabled():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="Wysyłka SMS nie jest skonfigurowana."
        )
    if kind == "email" and not (mailer.enabled() or mailer.outbox is not None):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="Wysyłka e-mail nie jest skonfigurowana."
        )
    # poprzednie niewykorzystane kody tego rodzaju przestają działać
    for old in db.scalars(
        select(ContactVerification).where(
            ContactVerification.employee_id == e.id,
            ContactVerification.kind == kind,
            ContactVerification.used_at.is_(None),
        )
    ):
        old.used_at = now
    code = f"{secrets.randbelow(10**6):06d}"
    db.add(
        ContactVerification(
            employee_id=e.id,
            kind=kind,
            value_enc=crypto.encrypt_contact(value),
            code_hash=_code_hash(e.id, kind, code),
            expires_at=now + timedelta(minutes=CODE_MINUTES),
        )
    )
    try:
        if kind == "phone":
            sms.send(
                value, f"APT: kod potwierdzający {code}. Ważny {CODE_MINUTES} min. Nie podawaj go nikomu."
            )
        else:
            mailer.send(
                value,
                Email(
                    subject="Kod potwierdzający adres e-mail – Identyfikacja pracowników APT",
                    title="Potwierdź adres e-mail",
                    greeting=f"Dzień dobry {e.first_name},",
                    paragraphs=["wpisz w aplikacji poniższy kod, aby potwierdzić ten adres."],
                    details=[("Kod", code)],
                    notice=f"Kod jest ważny {CODE_MINUTES} minut. Nie podawaj go nikomu.",
                    footer_note="Jeśli to nie Ty – zignoruj tę wiadomość.",
                ),
            )
    except sms.SmsError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    audit(
        db,
        request,
        "contact_code_sent",
        user=user,
        username=who,
        entity_type="employee",
        entity_id=e.id,
        details={"kind": kind},
    )
    db.commit()
    return ContactStartOut(sent_to=_masked(kind, value), expires_minutes=CODE_MINUTES)


@router.post("/contact/{kind}/start", response_model=ContactStartOut)
def contact_start(
    kind: Kind, body: ContactStartIn, ctx: Auth, request: Request, db: DbSession
) -> ContactStartOut:
    return start_contact(db, request, _me_employee(ctx, db), kind, body.value, ctx.user, ctx.user.username)


class ContactConfirmIn(BaseModel):
    code: str = Field(min_length=4, max_length=10)


def confirm_contact(
    db: Session, request: Request, e: Employee, kind: Kind, raw_code: str, user: User | None, who: str
) -> None:
    now = utcnow()
    v = db.scalar(
        select(ContactVerification)
        .where(
            ContactVerification.employee_id == e.id,
            ContactVerification.kind == kind,
            ContactVerification.used_at.is_(None),
        )
        .order_by(ContactVerification.id.desc())
    )
    if v is None or v.expires_at <= now or v.attempts >= MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Kod wygasł. Poproś o nowy.")
    code = re.sub(r"\D", "", raw_code)
    if not secrets.compare_digest(v.code_hash, _code_hash(e.id, kind, code)):
        v.attempts += 1
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy kod.")
    v.used_at = now
    if kind == "phone":
        e.phone_enc, e.phone_verified_at = v.value_enc, now
    else:
        e.email_enc, e.email_verified_at = v.value_enc, now
    audit(
        db,
        request,
        "contact_changed",
        user=user,
        username=who,
        entity_type="employee",
        entity_id=e.id,
        details={"kind": kind},
    )
    db.commit()


@router.post("/contact/{kind}/confirm", response_model=MyEmployeeOut)
def contact_confirm(
    kind: Kind, body: ContactConfirmIn, ctx: Auth, request: Request, db: DbSession
) -> MyEmployeeOut:
    confirm_contact(db, request, _me_employee(ctx, db), kind, body.code, ctx.user, ctx.user.username)
    return my_employee(ctx, db)


def remove_contact(
    db: Session, request: Request, e: Employee, kind: Kind, user: User | None, who: str
) -> None:
    if kind == "phone":
        e.phone_enc = e.phone_verified_at = None
    else:
        e.email_enc = e.email_verified_at = None
    audit(
        db,
        request,
        "contact_removed",
        user=user,
        username=who,
        entity_type="employee",
        entity_id=e.id,
        details={"kind": kind},
    )
    db.commit()


@router.delete("/contact/{kind}", response_model=MyEmployeeOut)
def contact_remove(kind: Kind, ctx: Auth, request: Request, db: DbSession) -> MyEmployeeOut:
    remove_contact(db, request, _me_employee(ctx, db), kind, ctx.user, ctx.user.username)
    return my_employee(ctx, db)
