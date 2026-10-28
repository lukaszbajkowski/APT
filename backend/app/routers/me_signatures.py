"""„Do podpisu” w koncie pracownika: lista dokumentów, podgląd stron, podpis z kluczem dostępu.

Pracownik z kontem podpisuje wyłącznie po zalogowaniu; sam podpis wymaga dodatkowo użycia klucza dostępu
(Face ID / odcisk palca / PIN) – to zastępuje jednorazowe sprawdzenie urządzenia z linku do podpisu.
"""

import io
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import signing, storage, templating
from app.audit import audit
from app.deps import Auth, DbSession, utcnow
from app.models import DocumentSignature, Employee, GeneratedDocument, Role
from app.routers.passkeys import reauth_options, verify_reauth
from app.routers.signatures import _complete, _dir, _open, accept_trusted_file, current_pdf

router = APIRouter(prefix="/api/me/signatures", tags=["me"])


def _employee(ctx: Auth, db: DbSession) -> Employee:
    if ctx.user.role != Role.employee or ctx.user.employee_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    e = db.get(Employee, ctx.user.employee_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
    return e


def _mine(db: DbSession, e: Employee, sig_id: int) -> tuple[DocumentSignature, GeneratedDocument]:
    sig = db.get(DocumentSignature, sig_id)
    doc = db.get(GeneratedDocument, sig.document_id) if sig else None
    if (
        sig is None
        or doc is None
        or doc.deleted_at is not None
        or doc.employee_id != e.id
        or sig.role != "pracownika"
        or sig.channel != "konto"
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono dokumentu do podpisu.")
    return sig, doc


class ToSign(BaseModel):
    id: int
    document: str
    requested_at: datetime
    requested_by: str | None


class Signed(BaseModel):
    id: int
    document: str
    signed_at: datetime | None


class ListOut(BaseModel):
    pending: list[ToSign]
    signed: list[Signed]


def _pending(db: DbSession, e: Employee) -> list[tuple[DocumentSignature, GeneratedDocument]]:
    rows = db.execute(
        select(DocumentSignature, GeneratedDocument)
        .join(GeneratedDocument, GeneratedDocument.id == DocumentSignature.document_id)
        .where(
            GeneratedDocument.employee_id == e.id,
            GeneratedDocument.deleted_at.is_(None),
            DocumentSignature.role == "pracownika",
            DocumentSignature.channel == "konto",
            DocumentSignature.status == "pending",
        )
        .order_by(DocumentSignature.id.desc())
    ).all()
    return [(s, d) for s, d in rows]


@router.get("", response_model=ListOut)
def my_list(ctx: Auth, db: DbSession) -> ListOut:
    e = _employee(ctx, db)
    signed = db.execute(
        select(DocumentSignature, GeneratedDocument)
        .join(GeneratedDocument, GeneratedDocument.id == DocumentSignature.document_id)
        .where(
            GeneratedDocument.employee_id == e.id,
            GeneratedDocument.deleted_at.is_(None),
            DocumentSignature.role == "pracownika",
            DocumentSignature.channel == "konto",
            DocumentSignature.status == "signed",
        )
        .order_by(DocumentSignature.signed_at.desc())
        .limit(20)
    ).all()
    return ListOut(
        pending=[
            ToSign(
                id=s.id, document=d.template_name, requested_at=s.created_at, requested_by=s.requested_by_name
            )
            for s, d in _pending(db, e)
        ],
        signed=[Signed(id=s.id, document=d.template_name, signed_at=s.signed_at) for s, d in signed],
    )


@router.get("/count")
def my_count(ctx: Auth, db: DbSession) -> dict[str, Any]:
    e = _employee(ctx, db)
    n = db.scalar(
        select(func.count())
        .select_from(DocumentSignature)
        .join(GeneratedDocument, GeneratedDocument.id == DocumentSignature.document_id)
        .where(
            GeneratedDocument.employee_id == e.id,
            GeneratedDocument.deleted_at.is_(None),
            DocumentSignature.role == "pracownika",
            DocumentSignature.channel == "konto",
            DocumentSignature.status == "pending",
        )
    )
    last = db.execute(
        select(DocumentSignature, GeneratedDocument)
        .join(GeneratedDocument, GeneratedDocument.id == DocumentSignature.document_id)
        .where(
            GeneratedDocument.employee_id == e.id,
            GeneratedDocument.deleted_at.is_(None),
            DocumentSignature.role == "pracownika",
            DocumentSignature.channel == "konto",
            DocumentSignature.status == "signed",
        )
        .order_by(DocumentSignature.signed_at.desc())
        .limit(1)
    ).first()
    last_signed = (
        {"id": last[0].id, "document": last[1].template_name, "signed_at": last[0].signed_at}
        if last
        else None
    )
    return {"pending": n or 0, "last_signed": last_signed}


class InfoOut(BaseModel):
    id: int
    document: str
    pages: int


@router.get("/{sig_id}", response_model=InfoOut)
def info(sig_id: int, ctx: Auth, db: DbSession) -> InfoOut:
    import pypdfium2 as pdfium

    sig, doc = _mine(db, _employee(ctx, db), sig_id)
    _open(sig)
    return InfoOut(id=sig.id, document=doc.template_name, pages=len(pdfium.PdfDocument(current_pdf(doc))))


@router.get("/{sig_id}/page/{n}")
def page(sig_id: int, n: int, ctx: Auth, db: DbSession) -> Response:
    import pypdfium2 as pdfium

    sig, doc = _mine(db, _employee(ctx, db), sig_id)
    _open(sig)
    pdf = pdfium.PdfDocument(current_pdf(doc))
    if not 0 <= n < len(pdf):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiej strony.")
    img = pdf[n].render(scale=1.6).to_pil()
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG", optimize=True)
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/{sig_id}/challenge")
def challenge(sig_id: int, ctx: Auth, request: Request, db: DbSession) -> dict[str, Any]:
    """Wyzwanie klucza dostępu do podpisu (pobierane z góry – Safari wymaga szybkiej reakcji)."""
    sig, _ = _mine(db, _employee(ctx, db), sig_id)
    _open(sig)
    out = reauth_options(db, request, ctx.user)
    db.commit()
    return out


@router.get("/{sig_id}/pdf")
def pdf(sig_id: int, ctx: Auth, request: Request, db: DbSession) -> Response:
    """Pobranie dokumentu do podpisania poza aplikacją (podpis zaufany / kwalifikowany)."""
    e = _employee(ctx, db)
    sig, doc = _mine(db, e, sig_id)
    _open(sig)
    audit(
        db,
        request,
        "document_downloaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"template": doc.template_name, "format": "to_sign", "own": True},
    )
    db.commit()
    name = templating.safe_filename(doc.template_name) + ".pdf"
    return Response(
        current_pdf(doc),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


@router.post("/{sig_id}/trusted")
async def trusted(
    sig_id: int, file: Annotated[UploadFile, File()], ctx: Auth, request: Request, db: DbSession
) -> dict[str, Any]:
    """Plik podpisany podpisem zaufanym lub kwalifikowanym – zamiast podpisu na ekranie."""
    e = _employee(ctx, db)
    sig, doc = _mine(db, e, sig_id)
    _open(sig)
    return await accept_trusted_file(
        db, request, sig, doc, e, file, f"{e.first_name} {e.last_name}", {"account": True}
    )


class SignIn(BaseModel):
    image: str = Field(min_length=50, max_length=3_000_000)
    consent: bool
    challenge_id: str = Field(max_length=64)
    credential: dict


@router.post("/{sig_id}/sign")
def sign(sig_id: int, body: SignIn, ctx: Auth, request: Request, db: DbSession) -> dict[str, bool]:
    e = _employee(ctx, db)
    sig, doc = _mine(db, e, sig_id)
    _open(sig)
    if not body.consent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Zaznacz, że zapoznałeś się z dokumentem.")
    try:
        png = signing.decode_signature(body.image)
    except signing.SignatureError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    credential_id = verify_reauth(db, request, ctx.user, body.challenge_id, body.credential)
    db.refresh(sig, with_for_update=True)  # dwa równoległe żądania nie mogą oba złożyć podpisu
    _open(sig)
    sig.device_credential, sig.device_verified_at = credential_id, utcnow()
    sig.file_name = f"{doc.id}_sig_{sig.id}.png"
    storage.write(_dir(doc) / sig.file_name, png)
    _complete(
        db,
        request,
        sig,
        doc,
        e,
        "ekran",
        f"{e.first_name} {e.last_name}",
        {"signature_png_sha256": signing.sha256(png), "account": True},
    )
    return {"ok": True}


# --- podgląd i pobranie własnych podpisanych dokumentów -----------------------------------------


def _mine_signed(db: DbSession, e: Employee, sig_id: int) -> tuple[DocumentSignature, GeneratedDocument]:
    sig, doc = _mine(db, e, sig_id)
    if sig.status != "signed":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono podpisanego dokumentu.")
    return sig, doc


class SignedInfo(BaseModel):
    id: int
    document: str
    pages: int
    signed_at: datetime | None
    complete: bool  # dokument ma już wszystkie podpisy (np. także firmy)


@router.get("/signed/{sig_id}", response_model=SignedInfo)
def signed_info(sig_id: int, ctx: Auth, db: DbSession) -> SignedInfo:
    import pypdfium2 as pdfium

    sig, doc = _mine_signed(db, _employee(ctx, db), sig_id)
    return SignedInfo(
        id=sig.id,
        document=doc.template_name,
        pages=len(pdfium.PdfDocument(current_pdf(doc))),
        signed_at=sig.signed_at,
        complete=doc.signed_at is not None,
    )


@router.get("/signed/{sig_id}/page/{n}")
def signed_page(sig_id: int, n: int, ctx: Auth, db: DbSession) -> Response:
    import pypdfium2 as pdfium

    sig, doc = _mine_signed(db, _employee(ctx, db), sig_id)
    pdf = pdfium.PdfDocument(current_pdf(doc))
    if not 0 <= n < len(pdf):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiej strony.")
    img = pdf[n].render(scale=1.6).to_pil()
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG", optimize=True)
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/signed/{sig_id}/pdf")
def signed_pdf(sig_id: int, ctx: Auth, request: Request, db: DbSession) -> Response:
    e = _employee(ctx, db)
    sig, doc = _mine_signed(db, e, sig_id)
    audit(
        db,
        request,
        "document_downloaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"template": doc.template_name, "format": "signed", "own": True},
    )
    db.commit()
    name = templating.safe_filename(f"{doc.template_name}_podpisany") + ".pdf"
    return Response(
        current_pdf(doc),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )
