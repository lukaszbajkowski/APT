"""Aktualizacja danych bez konta: kadry wysyłają link, pracownik potwierdza datę urodzenia
i sam zmienia zdjęcie oraz telefon / e-mail (kontakt dopiero po kodzie, jak w „Moje dane”).

Link działa przez 7 dni, po 5 błędnych datach urodzenia jest blokowany, a nowy link unieważnia poprzedni.
Pracownik z aktywnym kontem robi to w aplikacji – dla niego link nie jest wystawiany.
"""

import hashlib
import hmac
import time
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, File, Header, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crypto, mailer, photos, sms, storage
from app.audit import audit
from app.config import get_settings
from app.deps import DbSession, StaffAuth, utcnow
from app.emails import Email
from app.models import DataLink, Employee, User, WebauthnCredential
from app.routers import me as me_mod
from app.routers.employees import store_uploaded_photo
from app.security import new_token, token_hash

LINK_DAYS = 7
MAX_ATTEMPTS = 5
ACCESS_SECONDS = 1800
WHO = "link-aktualizacji"

staff_router = APIRouter(prefix="/api/employees", tags=["data-link"])
public_router = APIRouter(prefix="/api/data-link", tags=["data-link"])


# --- kadry --------------------------------------------------------------------------------


class LinkStatus(BaseModel):
    account_active: bool
    has_birth_date: bool
    active: bool
    expires_at: datetime | None = None
    created_at: datetime | None = None
    last_used_at: datetime | None = None


def _employee(db: Session, employee_id: int) -> Employee:
    e = db.get(Employee, employee_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
    return e


def _active_link(db: Session, employee_id: int) -> DataLink | None:
    return db.scalar(
        select(DataLink)
        .where(
            DataLink.employee_id == employee_id,
            DataLink.status == "active",
            DataLink.expires_at > utcnow(),
        )
        .order_by(DataLink.id.desc())
    )


def _has_account(db: Session, employee_id: int) -> bool:
    u = db.scalar(select(User).where(User.employee_id == employee_id))
    if u is None:
        return False
    return (
        db.scalar(select(WebauthnCredential.id).where(WebauthnCredential.user_id == u.id).limit(1))
        is not None
    )


def _status(db: Session, e: Employee) -> LinkStatus:
    link = _active_link(db, e.id)
    return LinkStatus(
        account_active=_has_account(db, e.id),
        has_birth_date=e.birth_date is not None,
        active=link is not None,
        expires_at=link.expires_at if link else None,
        created_at=link.created_at if link else None,
        last_used_at=link.last_used_at if link else None,
    )


@staff_router.get("/{employee_id}/data-link", response_model=LinkStatus)
def link_status(employee_id: int, ctx: StaffAuth, db: DbSession) -> LinkStatus:
    return _status(db, _employee(db, employee_id))


class LinkIn(BaseModel):
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str | None = Field(default=None, max_length=30)


class LinkOut(BaseModel):
    link: str
    sent: list[str]
    status: LinkStatus


def _email(e: Employee, link: str) -> Email:
    return Email(
        subject="Zaktualizuj swoje dane – Identyfikacja pracowników APT",
        title="Aktualizacja danych",
        preheader=f"Link jest ważny {LINK_DAYS} dni.",
        greeting=f"Dzień dobry {e.first_name},",
        paragraphs=[
            "kadry proszą o aktualizację Twoich danych kontaktowych i zdjęcia w systemie identyfikacji.",
            "Otwórz link i potwierdź datę urodzenia.",
        ],
        button=("Zaktualizuj dane", link),
        notice=f"Link jest ważny {LINK_DAYS} dni. Nie przekazuj go nikomu.",
        footer_note="Jeśli nie spodziewałeś się tej wiadomości – zignoruj ją.",
    )


@staff_router.post("/{employee_id}/data-link", response_model=LinkOut)
def create_link(employee_id: int, body: LinkIn, ctx: StaffAuth, request: Request, db: DbSession) -> LinkOut:
    e = _employee(db, employee_id)
    if _has_account(db, e.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Pracownik ma aktywne konto – zmienia dane w aplikacji."
        )
    if e.birth_date is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Uzupełnij datę urodzenia w kartotece – bez niej nie da się potwierdzić tożsamości.",
        )
    if body.email and not (mailer.enabled() or mailer.outbox is not None):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Brak konfiguracji poczty.")
    if body.phone and not sms.enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Brak konfiguracji SMS.")
    now = utcnow()
    for old in db.scalars(select(DataLink).where(DataLink.employee_id == e.id, DataLink.status == "active")):
        old.status, old.token_hash = "cancelled", None
    token = new_token()
    db.add(
        DataLink(
            employee_id=e.id,
            token_hash=token_hash(token),
            created_by=ctx.user.id,
            expires_at=now + timedelta(days=LINK_DAYS),
        )
    )
    link = mailer.link("/aktualizacja?token=" + token)
    sent: list[str] = []
    try:
        if body.email:
            mailer.send(body.email, _email(e, link))
            sent.append("e-mail")
        if body.phone:
            sms.send(body.phone, f"APT: aktualizacja danych: {link} (wazny {LINK_DAYS} dni)")
            sent.append("SMS")
    except sms.SmsError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 – błąd poczty nie może zostawić niewysłanego, aktywnego linku
        db.rollback()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Nie udało się wysłać wiadomości.") from exc
    audit(
        db,
        request,
        "data_link_created",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"sent": sent},
    )
    db.commit()
    return LinkOut(link=link, sent=sent, status=_status(db, e))


@staff_router.delete("/{employee_id}/data-link", response_model=LinkStatus)
def cancel_link(employee_id: int, ctx: StaffAuth, request: Request, db: DbSession) -> LinkStatus:
    e = _employee(db, employee_id)
    for old in db.scalars(select(DataLink).where(DataLink.employee_id == e.id, DataLink.status == "active")):
        old.status, old.token_hash = "cancelled", None
    audit(db, request, "data_link_cancelled", user=ctx.user, entity_type="employee", entity_id=e.id)
    db.commit()
    return _status(db, e)


# --- publiczna strona pracownika --------------------------------------------------------------


def _by_token(db: Session, token: str) -> tuple[DataLink, Employee]:
    link = db.scalar(select(DataLink).where(DataLink.token_hash == token_hash(token)))
    if link is None or link.status != "active":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Link jest nieprawidłowy albo został unieważniony."
        )
    if link.expires_at < datetime.now(UTC):
        raise HTTPException(status.HTTP_410_GONE, detail="Link wygasł – poproś kadry o nowy.")
    e = db.get(Employee, link.employee_id)
    if e is None or _has_account(db, e.id):
        raise HTTPException(
            status.HTTP_410_GONE, detail="Link nie jest już potrzebny – zaloguj się do konta."
        )
    return link, e


def _key(link: DataLink, exp: int) -> str:
    msg = f"{link.id}:{link.token_hash}:{exp}".encode()
    mac = hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{mac}"


def _authorized(db: Session, token: str, access: str | None) -> tuple[DataLink, Employee]:
    link, e = _by_token(db, token)
    denied = HTTPException(status.HTTP_403_FORBIDDEN, detail="Najpierw potwierdź datę urodzenia.")
    try:
        exp = int((access or "").split(".", 1)[0])
    except ValueError as exc:
        raise denied from exc
    if exp < time.time() or not hmac.compare_digest(_key(link, exp), access or ""):
        raise denied
    return link, e


Access = Annotated[str | None, Header(alias="X-Link-Access")]


class LinkInfo(BaseModel):
    first_name: str
    expires_at: datetime


@public_router.get("/{token}", response_model=LinkInfo)
def info(token: str, db: DbSession) -> LinkInfo:
    link, e = _by_token(db, token)
    return LinkInfo(first_name=e.first_name, expires_at=link.expires_at)


class VerifyIn(BaseModel):
    birth_date: date


class VerifyOut(BaseModel):
    access: str


@public_router.post("/{token}/verify", response_model=VerifyOut)
def verify(token: str, body: VerifyIn, request: Request, db: DbSession) -> VerifyOut:
    link, e = _by_token(db, token)
    if body.birth_date != e.birth_date:
        link.failed_attempts += 1
        left = MAX_ATTEMPTS - link.failed_attempts
        if left <= 0:
            link.status, link.token_hash = "cancelled", None
            audit(db, request, "data_link_locked", username=WHO, entity_type="employee", entity_id=e.id)
        db.commit()
        if left <= 0:
            raise HTTPException(
                status.HTTP_410_GONE, detail="Za dużo błędnych prób – link zablokowano. Poproś kadry o nowy."
            )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail=f"Data urodzenia się nie zgadza. Pozostało prób: {left}."
        )
    link.last_used_at = utcnow()
    db.commit()
    return VerifyOut(access=_key(link, int(time.time()) + ACCESS_SECONDS))


class MyData(BaseModel):
    first_name: str
    last_name: str
    has_photo: bool
    photo_version: str | None
    phone: str | None  # zamaskowany
    phone_verified: bool
    email: str | None  # zamaskowany
    email_verified: bool


def _data(e: Employee) -> MyData:
    def masked(kind: me_mod.Kind, blob: bytes | None) -> str | None:
        try:
            return me_mod._masked(kind, crypto.decrypt_contact(blob)) if blob else None
        except ValueError:
            return None

    return MyData(
        first_name=e.first_name,
        last_name=e.last_name,
        has_photo=e.photo is not None,
        photo_version=str(e.photo.id) if e.photo else None,
        phone=masked("phone", e.phone_enc),
        phone_verified=e.phone_verified_at is not None,
        email=masked("email", e.email_enc),
        email_verified=e.email_verified_at is not None,
    )


@public_router.get("/{token}/data", response_model=MyData)
def data(token: str, db: DbSession, access: Access = None) -> MyData:
    _, e = _authorized(db, token, access)
    return _data(e)


@public_router.get("/{token}/photo")
def photo(token: str, db: DbSession, access: Access = None, k: str | None = None) -> Response:
    _, e = _authorized(db, token, access or k)
    if e.photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak zdjęcia.")
    path = photos.path_for(e.photo.file_name)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku zdjęcia.")
    return Response(
        storage.read(path),
        media_type=e.photo.content_type,
        headers={"Cache-Control": "private, no-store"},
    )


@public_router.put("/{token}/photo", response_model=MyData)
async def upload_photo(
    token: str, request: Request, db: DbSession, file: Annotated[UploadFile, File()], access: Access = None
) -> MyData:
    _, e = _authorized(db, token, access)
    await store_uploaded_photo(db, request, None, e, file, who=WHO)
    return _data(e)


@public_router.post("/{token}/contact/{kind}/start", response_model=me_mod.ContactStartOut)
def contact_start(
    token: str,
    kind: me_mod.Kind,
    body: me_mod.ContactStartIn,
    request: Request,
    db: DbSession,
    access: Access = None,
) -> me_mod.ContactStartOut:
    _, e = _authorized(db, token, access)
    return me_mod.start_contact(db, request, e, kind, body.value, None, WHO)


@public_router.post("/{token}/contact/{kind}/confirm", response_model=MyData)
def contact_confirm(
    token: str,
    kind: me_mod.Kind,
    body: me_mod.ContactConfirmIn,
    request: Request,
    db: DbSession,
    access: Access = None,
) -> MyData:
    _, e = _authorized(db, token, access)
    me_mod.confirm_contact(db, request, e, kind, body.code, None, WHO)
    return _data(e)


@public_router.delete("/{token}/contact/{kind}", response_model=MyData)
def contact_remove(
    token: str, kind: me_mod.Kind, request: Request, db: DbSession, access: Access = None
) -> MyData:
    _, e = _authorized(db, token, access)
    me_mod.remove_contact(db, request, e, kind, None, WHO)
    return _data(e)


@staff_router.delete("/{employee_id}/contact/{kind}", status_code=status.HTTP_204_NO_CONTENT)
def staff_remove_contact(
    employee_id: int, kind: me_mod.Kind, ctx: StaffAuth, request: Request, db: DbSession
) -> None:
    """Kadry / administrator usuwają zapisany telefon albo e-mail pracownika."""
    me_mod.remove_contact(db, request, _employee(db, employee_id), kind, ctx.user, ctx.user.username)
