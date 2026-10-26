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
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import mailer, notify, signing, sms, templating
from app.audit import audit, client_ip, user_agent
from app.config import get_settings
from app.deps import AuthContext, DbSession, require_roles
from app.models import DocumentSignature, Employee, GeneratedDocument, Role
from app.routers.employees import format_number
from app.security import new_token, token_hash

router = APIRouter(prefix="/api", tags=["signatures"])
DocAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]

MAX_ATTEMPTS = 5
MAX_UPLOAD = 15 * 1024 * 1024
VIEW_SECONDS = 3600


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
    return path.read_bytes()


def current_pdf(doc: GeneratedDocument) -> bytes:
    signed = _dir(doc) / f"{doc.id}_signed.pdf"
    return signed.read_bytes() if doc.has_signed_pdf and signed.exists() else original_pdf(doc)


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
            png = (_dir(doc) / s.file_name).read_bytes()
        applied.append(
            signing.AppliedSignature(
                role=s.role,
                signer_name=s.signer_name or "",
                signed_at=s.signed_at or datetime.now(UTC),
                method=s.method or "ekran",
                image_png=png,
                ip=str(s.ip) if s.ip else None,
                user_agent=s.user_agent,
            )
        )
    if not applied:
        return
    pdf = signing.stamp(original_pdf(doc), applied, doc.template_name, str(doc.id))
    (_dir(doc) / f"{doc.id}_signed.pdf").write_bytes(pdf)
    doc.has_signed_pdf = True


def _finish_if_complete(db: Session, doc: GeneratedDocument) -> None:
    signed_roles = {s.role for s in _sigs(db, doc) if s.status == "signed"}
    if "skan" in signed_roles or (doc.signature_roles and set(doc.signature_roles) <= signed_roles):
        doc.signed_at = doc.signed_at or datetime.now(UTC)


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


class SignaturesOut(BaseModel):
    roles: list[RoleState]
    signed_at: datetime | None
    has_signed_pdf: bool
    scan: bool
    sms_enabled: bool
    email_enabled: bool


def _state(db: Session, doc: GeneratedDocument) -> SignaturesOut:
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
            )
        roles.append(st)
    return SignaturesOut(
        roles=roles,
        signed_at=doc.signed_at,
        has_signed_pdf=doc.has_signed_pdf,
        scan=any(s.role == "skan" and s.status == "signed" for s in sigs),
        sms_enabled=sms.enabled(),
        email_enabled=mailer.enabled() or mailer.outbox is not None,
    )


def _get(db: Session, ctx: AuthContext, document_id: uuid.UUID) -> tuple[GeneratedDocument, Employee]:
    from app.routers.documents import _get_doc

    doc, e, _ = _get_doc(db, ctx.user, document_id)
    return doc, e


@router.get("/documents/{document_id}/signatures", response_model=SignaturesOut)
def get_signatures(document_id: uuid.UUID, ctx: DocAuth, db: DbSession) -> SignaturesOut:
    doc, _ = _get(db, ctx, document_id)
    return _state(db, doc)


class RequestIn(BaseModel):
    role: str
    channel: Literal["email", "sms", "link"] = "link"
    to: str | None = Field(default=None, max_length=254)


class RequestOut(BaseModel):
    id: int
    link: str
    expires_at: datetime
    sent: bool
    qr_svg: str


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
        },
    )
    db.commit()
    from app.totp import qr_svg

    return RequestOut(id=sig.id, link=url, expires_at=expires, sent=sent, qr_svg=qr_svg(url))


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
    (_dir(doc) / sig.file_name).write_bytes(data)
    _finish_if_complete(db, doc)
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
    return _state(db, doc)


def _file_response(data: bytes, name: str, media: str, inline: bool = False) -> Response:
    disp = "inline" if inline else "attachment"
    return Response(
        data,
        media_type=media,
        headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{name}", "Cache-Control": "no-store"},
    )


SCAN_MEDIA = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}


def signed_file(db: Session, doc: GeneratedDocument) -> tuple[Path, str, str] | None:
    """Podpisana wersja dokumentu (ścieżka, rozszerzenie, typ): PDF z podpisami albo skan papieru."""
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


@router.get("/documents/{document_id}/signed")
def download_signed(
    document_id: uuid.UUID, ctx: DocAuth, request: Request, db: DbSession, inline: bool = False
) -> Response:
    """Podpisany dokument: PDF z podpisami z ekranu albo skan papierowego dokumentu."""
    doc, e = _get(db, ctx, document_id)
    base = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}_podpisany")
    found = signed_file(db, doc)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Dokument nie jest jeszcze podpisany.")
    path, ext, media = found
    data, name = path.read_bytes(), f"{base}.{ext}"
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
    sig = db.get(DocumentSignature, signature_id)
    if sig is None or sig.method != "zaufany" or not sig.file_name:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku.")
    doc, _ = _get(db, ctx, sig.document_id)
    ext = sig.file_name.rsplit(".", 1)[-1]
    return _file_response(
        (_dir(doc) / sig.file_name).read_bytes(),
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


class SignIn(BaseModel):
    image: str = Field(min_length=50, max_length=3_000_000)
    view: str | None = None
    signer_name: str | None = Field(default=None, max_length=200)
    consent: bool


def _complete(
    db: Session,
    request: Request,
    sig: DocumentSignature,
    doc: GeneratedDocument,
    e: Employee,
    method: str,
    name: str,
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
        },
    )
    db.commit()


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
    sig.file_name = f"{doc.id}_sig_{sig.id}.png"
    (_dir(doc) / sig.file_name).write_bytes(png)
    _complete(db, request, sig, doc, e, "ekran", name)
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
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik jest za duży (max 15 MB).")
    fname = file.filename or "podpisany"
    if not signing.looks_signed(data, fname):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ten plik nie wygląda na podpisany. Wgraj plik pobrany po podpisaniu (PDF albo XML).",
        )
    name = f"{e.first_name} {e.last_name}" if sig.role == "pracownika" else (signer_name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wpisz imię i nazwisko osoby podpisującej.")
    ext = "pdf" if data[:4] == b"%PDF" else "xml"
    sig.file_name = f"{doc.id}_sig_{sig.id}.{ext}"
    sig.original_name = fname[:255]
    (_dir(doc) / sig.file_name).write_bytes(data)
    _complete(db, request, sig, doc, e, "zaufany", name)
    return {"ok": True}
