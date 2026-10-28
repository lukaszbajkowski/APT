"""Podpis elektroniczny dokumentów.

Kadry wysyłają prośbę o podpis (e-mail, SMS albo link / kod QR do pokazania na miejscu).
Osoba podpisująca otwiera publiczną stronę /podpis/<token>: pracownik potwierdza datę urodzenia,
ogląda dokument i podpisuje się palcem na ekranie – albo dołącza plik podpisany podpisem zaufanym.
"""

import hashlib
import hmac
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import device, mailer, notify, qualified, signing, sms, storage, templating, trustlist
from app import timestamp as tsa
from app.audit import audit, client_ip, user_agent
from app.config import get_settings
from app.deps import AuthContext, DbSession, require_roles
from app.models import AuditLog, DocumentSignature, DocumentTemplate, Employee, GeneratedDocument, Role
from app.routers.employees import format_number
from app.routers.passkeys import employee_account
from app.security import new_token, token_hash

router = APIRouter(prefix="/api", tags=["signatures"])
DocAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]

MAX_ATTEMPTS = 5
MAX_UPLOAD = 15 * 1024 * 1024
VIEW_SECONDS = 3600


def forbid_download(user: Any) -> None:
    from app.routers.documents import forbid_download as f

    f(user)


# ---------- pliki ----------


def _dir(doc: GeneratedDocument) -> Path:
    p = Path(get_settings().data_dir) / "documents" / str(doc.employee_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def original_pdf(doc: GeneratedDocument) -> bytes:
    path = _dir(doc) / f"{doc.id}.pdf"
    if not doc.has_pdf or not path.exists():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Dokument nie ma wersji PDF – podpis niemożliwy."
        )
    return storage.read(path)


def current_pdf(doc: GeneratedDocument) -> bytes:
    signed = _dir(doc) / f"{doc.id}_signed.pdf"
    return storage.read(signed) if doc.has_signed_pdf and signed.exists() else original_pdf(doc)


def _sigs(db: Session, doc: GeneratedDocument) -> list[DocumentSignature]:
    return list(
        db.scalars(
            select(DocumentSignature)
            .where(DocumentSignature.document_id == doc.id)
            .order_by(DocumentSignature.id)
        )
    )


def _rebuild(db: Session, doc: GeneratedDocument) -> None:
    """Podpisany PDF = oryginał + wszystkie podpisy (zawsze od nowa, więc wynik jest powtarzalny)."""
    applied = []
    for s in _sigs(db, doc):
        if s.status != "signed" or s.method == "skan":
            continue
        png = None
        if s.method == "ekran" and s.file_name:
            png = storage.read(_dir(doc) / s.file_name)
        applied.append(
            signing.AppliedSignature(
                role=s.role,
                signer_name=s.signer_name or "",
                signed_at=s.signed_at or datetime.now(UTC),
                method=s.method or "ekran",
                image_png=png,
                ip=str(s.ip) if s.ip else None,
                user_agent=s.user_agent,
                device_credential=s.device_credential if s.device_verified_at else None,
                check_lines=qualified.lines(s.check_result) if s.check_result else None,
            )
        )
    if not applied:
        return
    pdf = signing.stamp(original_pdf(doc), applied, doc.template_name, str(doc.id))
    storage.write(_dir(doc) / f"{doc.id}_signed.pdf", pdf)
    doc.has_signed_pdf = True


def _finish_if_complete(db: Session, doc: GeneratedDocument) -> None:
    signed_roles = {s.role for s in _sigs(db, doc) if s.status == "signed"}
    if "skan" in signed_roles or (doc.signature_roles and set(doc.signature_roles) <= signed_roles):
        doc.signed_at = doc.signed_at or datetime.now(UTC)


# ---------- pieczęć integralności ----------
# W chwili każdej zmiany podpisanego pliku w dzienniku (tylko do dopisywania) zapisujemy skrót SHA-256 pliku.
# Późniejsza zmiana pliku na dysku bez nowego wpisu w dzienniku jest wykrywana i pokazywana kadrom.


def _signed_hash(db: Session, doc: GeneratedDocument) -> str | None:
    found = signed_file(db, doc)
    return signing.sha256(storage.read(found[0])) if found else None


def _seal(
    db: Session,
    request: Request | None,
    doc: GeneratedDocument,
    e: Employee,
    why: str,
    *,
    user: Any = None,
    username: str | None = None,
    evidence: dict[str, Any] | None = None,
) -> None:
    audit(
        db,
        request,
        "document_sealed",
        user=user,
        username=username,
        entity_type="employee",
        entity_id=e.id,
        details={
            "document_id": str(doc.id),
            "document": doc.template_name,
            "why": why,
            "original_sha256": signing.sha256(original_pdf(doc)),
            "signed_sha256": _signed_hash(db, doc),
            **(evidence or {}),
        },
    )


def _integrity(db: Session, doc: GeneratedDocument) -> str:
    """ok – plik zgodny z dziennikiem | mismatch – plik zmieniony poza aplikacją | unknown – brak pieczęci."""
    last = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "document_sealed", AuditLog.details["document_id"].astext == str(doc.id))
        .order_by(AuditLog.id.desc())
        .limit(1)
    )
    if last is None:
        return "unknown"
    try:
        current = _signed_hash(db, doc)
    except (OSError, storage.FileDecryptError):
        return "mismatch"
    return "ok" if current == (last.details or {}).get("signed_sha256") else "mismatch"


# ---------- dla kadr ----------


class RoleState(BaseModel):
    role: str
    label: str
    status: str  # none | pending | signed | expired
    request_id: int | None = None
    channel: str | None = None
    sent_to: str | None = None
    expires_at: datetime | None = None
    signer_name: str | None = None
    signed_at: datetime | None = None
    method: str | None = None
    device_check: bool = False  # link wymaga potwierdzenia blokadą urządzenia
    employee_account: bool = False  # pracownik ma aktywne konto – podpisuje po zalogowaniu
    device_verified: bool = False  # podpisano z potwierdzeniem blokadą urządzenia
    check: dict[str, Any] | None = None  # wynik weryfikacji pliku z podpisem zaufanym / kwalifikowanym


class SignaturesOut(BaseModel):
    roles: list[RoleState]
    signed_at: datetime | None
    has_signed_pdf: bool
    scan: bool
    scan_id: int | None = None
    scan_allowed: bool = True
    can_remove: bool = False
    can_download: bool = False
    sms_enabled: bool
    email_enabled: bool
    integrity: str = "unknown"  # ok | mismatch | unknown
    timestamp: dict[str, Any] | None = None  # zaufany znacznik czasu bieżącego pliku
    timestamp_enabled: bool = False


def _timestamp_info(db: Session, doc: GeneratedDocument) -> dict[str, Any] | None:
    try:
        return tsa.status(db, str(doc.id), _signed_hash(db, doc))
    except (OSError, storage.FileDecryptError):
        return None


def _state(db: Session, doc: GeneratedDocument, user: Any = None) -> SignaturesOut:
    now = datetime.now(UTC)
    sigs = _sigs(db, doc)
    roles = []
    for r in doc.signature_roles or []:
        mine = [s for s in sigs if s.role == r and s.status in ("pending", "signed")]
        st = RoleState(role=r, label=templating.SIGN_ROLES.get(r, r), status="none")
        if mine:
            s = mine[-1]
            expired = s.status == "pending" and s.expires_at is not None and s.expires_at < now
            st = RoleState(
                role=r,
                label=st.label,
                status="expired" if expired else s.status,
                request_id=s.id,
                channel=s.channel,
                sent_to=s.sent_to,
                expires_at=s.expires_at,
                signer_name=s.signer_name,
                signed_at=s.signed_at,
                method=s.method,
                device_check=s.device_check,
                device_verified=s.device_verified_at is not None,
                check=s.check_result,
            )
        st.employee_account = r == "pracownika" and employee_account(db, doc.employee_id) is not None
        roles.append(st)
    return SignaturesOut(
        roles=roles,
        signed_at=doc.signed_at,
        has_signed_pdf=doc.has_signed_pdf,
        scan=any(s.role == "skan" and s.status == "signed" for s in sigs),
        scan_allowed=not any(s.status == "signed" and s.role != "skan" for s in sigs),
        scan_id=next((s.id for s in sigs if s.role == "skan" and s.status == "signed"), None),
        can_remove=user is not None and user.role in (Role.admin, Role.hr),
        can_download=user is not None and user.role != Role.manager,
        sms_enabled=sms.enabled(),
        email_enabled=mailer.enabled() or mailer.outbox is not None,
        integrity=_integrity(db, doc),
        timestamp=_timestamp_info(db, doc),
        timestamp_enabled=tsa.enabled(),
    )


def _get(db: Session, ctx: AuthContext, document_id: uuid.UUID) -> tuple[GeneratedDocument, Employee]:
    from app.routers.documents import _get_doc

    doc, e, _ = _get_doc(db, ctx.user, document_id)
    return doc, e


@router.get("/documents/{document_id}/signatures", response_model=SignaturesOut)
def get_signatures(document_id: uuid.UUID, ctx: DocAuth, db: DbSession) -> SignaturesOut:
    doc, _ = _get(db, ctx, document_id)
    return _state(db, doc, ctx.user)


class RequestIn(BaseModel):
    role: str
    channel: Literal["email", "sms", "link"] = "link"
    to: str | None = Field(default=None, max_length=254)
    # wymagaj potwierdzenia blokadą urządzenia (Face ID / odcisk palca / PIN) przy podpisie na ekranie
    device_check: bool = False
    # wyjątek: link do podpisu mimo aktywnego konta pracownika (zostaje ślad w dzienniku)
    force_link: bool = False


class RequestOut(BaseModel):
    id: int
    link: str
    expires_at: datetime | None
    sent: bool
    qr_svg: str
    in_account: bool = False  # dokument trafił na listę „Do podpisu” w koncie pracownika
    notified: str | None = None  # gdzie wysłano powiadomienie (e-mail / SMS), jeśli udało się wysłać


def _mask(channel: str, to: str) -> str:
    if channel == "email" and "@" in to:
        name, dom = to.split("@", 1)
        return f"{name[:2]}***@{dom}"
    if channel == "sms":
        return f"***{to[-3:]}"
    return to


@router.post(
    "/documents/{document_id}/signatures", response_model=RequestOut, status_code=status.HTTP_201_CREATED
)
def request_signature(
    document_id: uuid.UUID, body: RequestIn, ctx: DocAuth, request: Request, db: DbSession
) -> RequestOut:
    doc, e = _get(db, ctx, document_id)
    if body.role not in (doc.signature_roles or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ten dokument nie ma miejsca na taki podpis.")
    original_pdf(doc)
    for s in _sigs(db, doc):
        if s.role == body.role and s.status == "signed":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ten podpis został już złożony.")
        if s.role == body.role and s.status == "pending":
            s.status, s.token_hash = "cancelled", None  # poprzedni link przestaje działać
    acct = employee_account(db, e.id) if body.role == "pracownika" else None
    if acct is not None and not body.force_link:
        return _request_in_account(db, request, ctx, doc, e, body)
    to = (body.to or "").strip()
    if body.channel in ("email", "sms") and not to:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Podaj adres e-mail albo numer telefonu.")
    if body.channel == "sms":
        try:
            to = sms.normalize_phone(to)
        except sms.SmsError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    token = new_token()
    expires = datetime.now(UTC) + timedelta(hours=get_settings().sign_link_hours)
    sig = DocumentSignature(
        document_id=doc.id,
        role=body.role,
        token_hash=token_hash(token),
        expires_at=expires,
        channel=body.channel,
        sent_to=_mask(body.channel, to) if to else None,
        requested_by_name=ctx.user.full_name,
        device_check=body.device_check,
    )
    db.add(sig)
    db.flush()
    url = mailer.link(f"/podpis/{token}")
    person = f"{e.first_name} {e.last_name}" if body.role == "pracownika" else "Pani/Panie"
    sent = False
    if body.channel == "email":
        if not (mailer.enabled() or mailer.outbox is not None):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Wysyłka e-maili nie jest skonfigurowana."
            )
        sent = mailer.send(to, notify.sign_request_email(person, doc.template_name, url, expires))
    elif body.channel == "sms":
        when = expires.astimezone(signing.TZ).strftime("%d.%m %H:%M")
        try:
            sms.send(to, f"Prosba o podpis dokumentu: {doc.template_name}. Otworz: {url} (wazny do {when})")
            sent = True
        except sms.SmsError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit(
        db,
        request,
        "signature_requested",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "document": doc.template_name,
            "role": body.role,
            "channel": body.channel,
            "to": sig.sent_to,
            "device_check": body.device_check,
        },
    )
    if acct is not None:
        audit(
            db,
            request,
            "signature_link_despite_account",
            user=ctx.user,
            entity_type="employee",
            entity_id=e.id,
            details={"number": format_number(e.number), "document": doc.template_name},
        )
    db.commit()
    from app.totp import qr_svg

    return RequestOut(id=sig.id, link=url, expires_at=expires, sent=sent, qr_svg=qr_svg(url))


def _contact_of(e: Employee) -> dict[str, str]:
    from app import crypto

    out: dict[str, str] = {}
    try:
        if e.email_enc and e.email_verified_at is not None:
            out["email"] = crypto.decrypt_contact(e.email_enc)
        if e.phone_enc and e.phone_verified_at is not None:
            out["sms"] = crypto.decrypt_contact(e.phone_enc)
    except ValueError:
        pass
    return out


def _request_in_account(
    db: Session, request: Request, ctx: AuthContext, doc: GeneratedDocument, e: Employee, body: RequestIn
) -> RequestOut:
    """Pracownik z kontem podpisuje wyłącznie po zalogowaniu: dokument trafia na jego listę „Do podpisu”."""
    sig = DocumentSignature(
        document_id=doc.id,
        role="pracownika",
        token_hash=None,
        expires_at=None,
        channel="konto",
        requested_by_name=ctx.user.full_name,
        device_check=True,
    )
    db.add(sig)
    db.flush()
    acct = employee_account(db, e.id)
    # ?u=: konto z dokumentem – aplikacja przełączy się na nie, jeśli jest zalogowane w tej przeglądarce
    url = mailer.link("/moje-konto/do-podpisu" + (f"?u={acct.id}" if acct else ""))
    notified: str | None = None
    contact = _contact_of(e)
    try:
        if "email" in contact and (mailer.enabled() or mailer.outbox is not None):
            if mailer.send(contact["email"], notify.account_sign_email(e.first_name, doc.template_name, url)):
                notified = "e-mail"
        elif "sms" in contact and sms.enabled():
            sms.send(
                contact["sms"], f"APT: nowy dokument do podpisu: {doc.template_name}. Zaloguj sie: {url}"
            )
            notified = "SMS"
    except Exception:  # noqa: BLE001 – brak powiadomienia nie blokuje prośby; dokument i tak jest w koncie
        notified = None
    sig.sent_to = notified
    audit(
        db,
        request,
        "signature_requested",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "document": doc.template_name,
            "role": "pracownika",
            "channel": "konto",
            "notified": notified,
        },
    )
    db.commit()
    return RequestOut(
        id=sig.id,
        link=url,
        expires_at=None,
        sent=notified is not None,
        qr_svg="",
        in_account=True,
        notified=notified,
    )


@router.delete("/signatures/{signature_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_request(signature_id: int, ctx: DocAuth, request: Request, db: DbSession) -> None:
    sig = db.get(DocumentSignature, signature_id)
    if sig is None or sig.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiej prośby o podpis.")
    doc, e = _get(db, ctx, sig.document_id)
    sig.status, sig.token_hash = "cancelled", None
    audit(
        db,
        request,
        "signature_cancelled",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "document": doc.template_name, "role": sig.role},
    )
    db.commit()


class RemoveIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/signatures/{signature_id}/remove", response_model=SignaturesOut)
def remove_signature(
    signature_id: int, body: RemoveIn, ctx: DocAuth, request: Request, db: DbSession
) -> SignaturesOut:
    """Usunięcie złożonego podpisu albo skanu (np. podpis złej osoby). Dokument wraca do podpisu."""
    if ctx.user.role not in (Role.admin, Role.hr):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Podpis może usunąć tylko administrator lub kadry."
        )
    sig = db.get(DocumentSignature, signature_id)
    if sig is None or sig.status != "signed":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiego podpisu.")
    doc, e = _get(db, ctx, sig.document_id)
    old_file = _dir(doc) / sig.file_name if sig.file_name else None
    sig.status, sig.token_hash = "removed", None
    db.flush()
    signed_pdf = _dir(doc) / f"{doc.id}_signed.pdf"
    signed_pdf.unlink(missing_ok=True)
    doc.has_signed_pdf, doc.signed_at = False, None
    _rebuild(db, doc)
    _finish_if_complete(db, doc)
    db.flush()
    _seal(db, request, doc, e, "removed", user=ctx.user)
    audit(
        db,
        request,
        "signature_removed",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "document": doc.template_name,
            "role": sig.role,
            "method": sig.method,
            "signer": sig.signer_name,
            "signed_at": sig.signed_at.isoformat() if sig.signed_at else None,
            "reason": body.reason.strip(),
        },
    )
    db.commit()
    if old_file:
        old_file.unlink(missing_ok=True)
    db.refresh(doc)
    return _state(db, doc, ctx.user)


ALLOWED_SCAN = {
    b"%PDF": ("pdf", "application/pdf"),
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
    b"\x89PNG": ("png", "image/png"),
}


@router.post("/documents/{document_id}/signatures/scan", response_model=SignaturesOut)
async def upload_scan(
    document_id: uuid.UUID,
    ctx: DocAuth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> SignaturesOut:
    """Skan podpisanego papierowego dokumentu – dokument uznajemy za podpisany."""
    doc, e = _get(db, ctx, document_id)
    if any(x.status == "signed" and x.role != "skan" for x in _sigs(db, doc)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Dokument ma już podpis elektroniczny – skan nie jest potrzebny. Usuń najpierw podpis.",
        )
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik jest za duży (max 15 MB).")
    kind = next((v for k, v in ALLOWED_SCAN.items() if data.startswith(k)), None)
    if kind is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Dozwolone pliki: PDF, JPG, PNG.")
    for s in _sigs(db, doc):
        if s.role == "skan":
            if s.file_name:
                (_dir(doc) / s.file_name).unlink(missing_ok=True)
            db.delete(s)
    db.flush()
    sig = DocumentSignature(
        document_id=doc.id,
        role="skan",
        status="signed",
        channel="skan",
        method="skan",
        signer_name=ctx.user.full_name,
        requested_by_name=ctx.user.full_name,
        signed_at=datetime.now(UTC),
        original_name=(file.filename or "skan")[:255],
    )
    db.add(sig)
    db.flush()
    sig.file_name = f"{doc.id}_sig_{sig.id}.{kind[0]}"
    storage.write(_dir(doc) / sig.file_name, data)
    _finish_if_complete(db, doc)
    db.flush()
    _seal(db, request, doc, e, "scan", user=ctx.user, evidence={"scan_sha256": signing.sha256(data)})
    audit(
        db,
        request,
        "signature_scan_uploaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "document": doc.template_name},
    )
    db.commit()
    tsa.schedule(str(doc.id))
    return _state(db, doc, ctx.user)


def _file_response(data: bytes, name: str, media: str, inline: bool = False) -> Response:
    disp = "inline" if inline else "attachment"
    return Response(
        data,
        media_type=media,
        headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{name}", "Cache-Control": "no-store"},
    )


SCAN_MEDIA = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}


def preview_extra(db: Session, doc: GeneratedDocument) -> bytes | None:
    """Strona potwierdzenia do podglądu pliku z podpisem zaufanym (podpis w pliku jest niewidoczny)."""
    path = _dir(doc) / f"{doc.id}_signed.pdf"
    trusted = any(s.status == "signed" and s.method == "zaufany" for s in _sigs(db, doc))
    if not (trusted and doc.has_signed_pdf and path.exists()):
        return None
    import io

    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(storage.read(path)))
    writer = PdfWriter()
    writer.add_page(reader.pages[-1])
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def signed_file(db: Session, doc: GeneratedDocument) -> tuple[Path, str, str] | None:
    """Podpisana wersja dokumentu (ścieżka, rozszerzenie, typ).

    Kolejność: plik (PDF albo XML) z podpisem zaufanym / kwalifikowanym – bez zmian, bo każda zmiana
    unieważniłaby podpis; PDF z podpisami z ekranu; skan papieru.
    """
    trusted = [s for s in _sigs(db, doc) if s.status == "signed" and s.method == "zaufany" and s.file_name]
    if trusted:
        last = max(trusted, key=lambda s: s.signed_at or datetime.min.replace(tzinfo=UTC))
        path = _dir(doc) / (last.file_name or "")
        if path.exists():
            if path.suffix == ".xml":  # XAdES z gov.pl – podpisany dokument jest w środku pliku XML
                return path, "xml", "application/xml"
            return path, "pdf", "application/pdf"
    if doc.has_signed_pdf:
        path = _dir(doc) / f"{doc.id}_signed.pdf"
        if path.exists():
            return path, "pdf", "application/pdf"
    scan = next((s for s in _sigs(db, doc) if s.role == "skan" and s.status == "signed"), None)
    if scan and scan.file_name:
        ext = scan.file_name.rsplit(".", 1)[-1]
        path = _dir(doc) / scan.file_name
        if ext in SCAN_MEDIA and path.exists():
            return path, ext, SCAN_MEDIA[ext]
    return None


@router.get("/documents/{document_id}/timestamp")
def download_timestamp(document_id: uuid.UUID, ctx: DocAuth, db: DbSession) -> Response:
    """Token znacznika czasu (RFC 3161, .tsr) bieżącego podpisanego pliku – do niezależnej weryfikacji."""
    forbid_download(ctx.user)
    doc, e = _get(db, ctx, document_id)
    found = tsa.token_for(db, str(doc.id), _signed_hash(db, doc))
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak znacznika czasu dla tego pliku.")
    name = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}_znacznik") + ".tsr"
    return _file_response(found[0], name, "application/timestamp-reply")


@router.get("/documents/{document_id}/signed")
def download_signed(
    document_id: uuid.UUID, ctx: DocAuth, request: Request, db: DbSession, inline: bool = False
) -> Response:
    """Podpisany dokument: PDF z podpisami z ekranu albo skan papierowego dokumentu."""
    if not inline:
        forbid_download(ctx.user)
    doc, e = _get(db, ctx, document_id)
    base = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}_podpisany")
    found = signed_file(db, doc)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dokument nie jest jeszcze podpisany.")
    path, ext, media = found
    data, name = storage.read(path), f"{base}.{ext}"
    audit(
        db,
        request,
        "document_downloaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "template": doc.template_name, "format": "signed"},
    )
    db.commit()
    return _file_response(data, name, media, inline)


@router.get("/signatures/{signature_id}/file")
def download_signature_file(signature_id: int, ctx: DocAuth, db: DbSession) -> Response:
    """Plik dołączony przy podpisie zaufanym (PDF / XML z podpisem)."""
    forbid_download(ctx.user)
    sig = db.get(DocumentSignature, signature_id)
    if sig is None or sig.method != "zaufany" or not sig.file_name:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku.")
    doc, _ = _get(db, ctx, sig.document_id)
    ext = sig.file_name.rsplit(".", 1)[-1]
    return _file_response(
        storage.read(_dir(doc) / sig.file_name),
        templating.safe_filename(sig.original_name or sig.file_name),
        "application/pdf" if ext == "pdf" else "application/xml",
    )


# ---------- publiczna strona podpisu ----------


def _by_token(db: Session, token: str) -> tuple[DocumentSignature, GeneratedDocument, Employee]:
    sig = db.scalar(select(DocumentSignature).where(DocumentSignature.token_hash == token_hash(token)))
    if sig is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Link jest nieprawidłowy albo został unieważniony."
        )
    doc = db.get(GeneratedDocument, sig.document_id)
    e = db.get(Employee, doc.employee_id) if doc else None
    if doc is None or e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dokument już nie istnieje.")
    return sig, doc, e


def _open(sig: DocumentSignature) -> None:
    if sig.status == "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Dokument został już podpisany. Dziękujemy!")
    if sig.status != "pending":
        raise HTTPException(status.HTTP_410_GONE, detail="Link został unieważniony – poproś o nowy.")
    if sig.expires_at and sig.expires_at < datetime.now(UTC):
        raise HTTPException(status.HTTP_410_GONE, detail="Link wygasł – poproś o nowy.")


def _needs_birth_date(sig: DocumentSignature, e: Employee) -> bool:
    return sig.role == "pracownika" and e.birth_date is not None


def _view_key(sig: DocumentSignature, exp: int) -> str:
    msg = f"{sig.id}:{sig.token_hash}:{exp}".encode()
    mac = hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{mac}"


def _check_view(sig: DocumentSignature, e: Employee, key: str | None) -> None:
    if not _needs_birth_date(sig, e):
        return
    try:
        exp_s, _ = (key or "").split(".", 1)
        exp = int(exp_s)
    except ValueError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Najpierw potwierdź datę urodzenia.") from exc
    if exp < time.time() or not hmac.compare_digest(_view_key(sig, exp), key or ""):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Najpierw potwierdź datę urodzenia.")


def _verify_birth(db: Session, sig: DocumentSignature, e: Employee, birth_date: date | None) -> None:
    if not _needs_birth_date(sig, e):
        return
    if birth_date != e.birth_date:
        sig.failed_attempts += 1
        left = MAX_ATTEMPTS - sig.failed_attempts
        if left <= 0:
            sig.status, sig.token_hash = "cancelled", None
        db.commit()
        if left <= 0:
            raise HTTPException(
                status.HTTP_410_GONE, detail="Za dużo błędnych prób – link zablokowano. Poproś o nowy."
            )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail=f"Data urodzenia się nie zgadza. Pozostało prób: {left}."
        )


class SignInfo(BaseModel):
    document: str
    person: str
    role: str
    role_label: str
    needs_birth_date: bool
    needs_name: bool
    expires_at: datetime | None
    pages: int | None = None
    device_check: bool = False


@router.get("/sign/{token}", response_model=SignInfo)
def sign_info(token: str, db: DbSession) -> SignInfo:
    sig, doc, e = _by_token(db, token)
    _open(sig)
    return SignInfo(
        document=doc.template_name,
        person=f"{e.first_name} {e.last_name[0]}." if sig.role == "pracownika" else "",
        role=sig.role,
        role_label=templating.SIGN_ROLES.get(sig.role, sig.role),
        needs_birth_date=_needs_birth_date(sig, e),
        needs_name=sig.role != "pracownika",
        expires_at=sig.expires_at,
        device_check=sig.device_check,
    )


class VerifyIn(BaseModel):
    birth_date: date | None = None


class VerifyOut(BaseModel):
    view: str
    pages: int


@router.post("/sign/{token}/verify", response_model=VerifyOut)
def sign_verify(token: str, body: VerifyIn, db: DbSession) -> VerifyOut:
    sig, doc, e = _by_token(db, token)
    _open(sig)
    _verify_birth(db, sig, e, body.birth_date)
    import pypdfium2 as pdfium

    pages = len(pdfium.PdfDocument(current_pdf(doc)))
    exp = int(time.time()) + VIEW_SECONDS
    return VerifyOut(view=_view_key(sig, exp), pages=pages)


@router.get("/sign/{token}/page/{n}")
def sign_page(token: str, n: int, db: DbSession, v: str | None = None) -> Response:
    sig, doc, e = _by_token(db, token)
    _open(sig)
    _check_view(sig, e, v)
    import io

    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(current_pdf(doc))
    if not 0 <= n < len(pdf):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiej strony.")
    img = pdf[n].render(scale=1.6).to_pil()
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG", optimize=True)
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/sign/{token}/pdf")
def sign_pdf(token: str, db: DbSession, v: str | None = None) -> Response:
    sig, doc, e = _by_token(db, token)
    _open(sig)
    _check_view(sig, e, v)
    return _file_response(
        current_pdf(doc), templating.safe_filename(doc.template_name) + ".pdf", "application/pdf"
    )


class DeviceOptionsIn(BaseModel):
    view: str | None = None


@router.post("/sign/{token}/device/options")
def sign_device_options(token: str, body: DeviceOptionsIn, request: Request, db: DbSession) -> dict[str, Any]:
    """Opcje potwierdzenia blokadą urządzenia (WebAuthn) – wyzwanie ważne dla tego jednego podpisu."""
    sig, _, e = _by_token(db, token)
    _open(sig)
    _check_view(sig, e, body.view)
    if not sig.device_check:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Ten podpis nie wymaga potwierdzenia urządzeniem."
        )
    rp_id, _ = device.rp_and_origin(request)
    options, challenge = device.new_options(rp_id)
    sig.device_challenge = challenge
    db.commit()
    return options


class SignIn(BaseModel):
    image: str = Field(min_length=50, max_length=3_000_000)
    view: str | None = None
    signer_name: str | None = Field(default=None, max_length=200)
    consent: bool
    device: dict[str, Any] | None = None  # odpowiedź przeglądarki z navigator.credentials.create()


def _complete(
    db: Session,
    request: Request,
    sig: DocumentSignature,
    doc: GeneratedDocument,
    e: Employee,
    method: str,
    name: str,
    evidence: dict[str, Any] | None = None,
) -> None:
    sig.status = "signed"
    sig.method = method
    sig.signer_name = name
    sig.signed_at = datetime.now(UTC)
    sig.token_hash = None
    sig.ip = client_ip(request)
    sig.user_agent = user_agent(request)
    db.flush()
    _rebuild(db, doc)
    _finish_if_complete(db, doc)
    audit(
        db,
        request,
        "document_signed",
        username=name,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "document": doc.template_name,
            "role": sig.role,
            "method": method,
            "device_verified": sig.device_verified_at is not None,
            "check": (sig.check_result or {}).get("level"),
            **(evidence or {}),
        },
    )
    _seal(db, request, doc, e, "signed", username=name, evidence={"role": sig.role, **(evidence or {})})
    db.commit()
    tsa.schedule(str(doc.id))


@router.post("/sign/{token}")
def sign(token: str, body: SignIn, request: Request, db: DbSession) -> dict[str, Any]:
    sig, doc, e = _by_token(db, token)
    _open(sig)
    _check_view(sig, e, body.view)
    if not body.consent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Zaznacz, że zapoznałeś się z dokumentem.")
    name = f"{e.first_name} {e.last_name}" if sig.role == "pracownika" else (body.signer_name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz imię i nazwisko osoby podpisującej.")
    try:
        png = signing.decode_signature(body.image)
    except signing.SignatureError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if sig.device_check:
        challenge, sig.device_challenge = sig.device_challenge, None  # wyzwanie jest jednorazowe
        db.commit()
        if not body.device or not challenge:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Ten podpis wymaga potwierdzenia blokadą urządzenia (Face ID, odcisk palca lub PIN).",
            )
        rp_id, origin = device.rp_and_origin(request)
        credential_id = device.verify(body.device, challenge, rp_id, origin)
    else:
        credential_id = None
    # blokada wiersza: dwa równoległe żądania z tym samym linkiem nie mogą oba złożyć podpisu
    db.refresh(sig, with_for_update=True)
    _open(sig)
    if credential_id:
        sig.device_credential, sig.device_verified_at = credential_id, datetime.now(UTC)
    sig.file_name = f"{doc.id}_sig_{sig.id}.png"
    storage.write(_dir(doc) / sig.file_name, png)
    _complete(db, request, sig, doc, e, "ekran", name, {"signature_png_sha256": signing.sha256(png)})
    return {"ok": True}


@router.post("/sign/{token}/trusted")
async def sign_trusted(
    token: str,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    view: Annotated[str | None, Form()] = None,
    signer_name: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Plik podpisany podpisem zaufanym (gov.pl) lub kwalifikowanym – PDF (PAdES) albo XML (XAdES)."""
    sig, doc, e = _by_token(db, token)
    _open(sig)
    _check_view(sig, e, view)
    name = f"{e.first_name} {e.last_name}" if sig.role == "pracownika" else (signer_name or "").strip()
    return await accept_trusted_file(db, request, sig, doc, e, file, name)


async def accept_trusted_file(
    db: Session,
    request: Request,
    sig: DocumentSignature,
    doc: GeneratedDocument,
    e: Employee,
    file: UploadFile,
    name: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Wspólna obsługa pliku z podpisem zaufanym/kwalifikowanym (link do podpisu i konto pracownika)."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik jest za duży (max 15 MB).")
    fname = file.filename or "podpisany"
    if not signing.looks_signed(data, fname):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ten plik nie wygląda na podpisany. Wgraj plik pobrany po podpisaniu (PDF albo XML).",
        )
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz imię i nazwisko osoby podpisującej.")
    roots = await run_in_threadpool(trustlist.load_roots)
    result = await run_in_threadpool(qualified.verify, data, roots)
    if result.level == "invalid":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Podpis w pliku jest nieprawidłowy. " + " ".join(result.notes),
        )
    shown = data if data[:4] == b"%PDF" else signing.embedded_pdf(data)
    tpl = db.get(DocumentTemplate, doc.template_id) if doc.template_id else None
    if tpl is not None and tpl.strict_pdf:
        # tryb ścisły: oryginał (ten sam co do bajta) musi być początkiem podpisanego pliku
        if shown is None or not qualified.starts_with_original(shown, original_pdf(doc), current_pdf(doc)):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Ten szablon wymaga, by podpis został dopisany do pobranego pliku bez żadnych zmian. "
                    "Pobierz dokument z aplikacji, podpisz go i wgraj ponownie, bez zapisu w innym programie."
                ),
            )
    elif (
        shown is not None
        and await run_in_threadpool(qualified.same_content, current_pdf(doc), shown) is False
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Podpisany plik ma inną treść niż ten dokument. Podpisz dokładnie pobrany plik.",
        )
    # blokada wiersza (po wszystkich oczekiwaniach async) – jeden podpis na jeden link
    db.refresh(sig, with_for_update=True)
    _open(sig)
    sig.check_result = result.as_dict()
    ext = "pdf" if data[:4] == b"%PDF" else "xml"
    sig.file_name = f"{doc.id}_sig_{sig.id}.{ext}"
    sig.original_name = fname[:255]
    storage.write(_dir(doc) / sig.file_name, data)
    _complete(
        db,
        request,
        sig,
        doc,
        e,
        "zaufany",
        name,
        {"uploaded_file_sha256": signing.sha256(data), **(extra or {})},
    )
    return {"ok": True, "check": sig.check_result}
