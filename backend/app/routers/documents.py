"""Szablony dokumentów (Administrator) i dokumenty generowane dla pracowników.

Generować mogą Administrator, Kadry i Kierownik (w swoim zakresie, tylko szablony z włączonym
„dostępny dla kierownika”). Kierownik dostaje dokument bez PESEL i daty urodzenia (puste pola)
i nie ma dostępu do dokumentów, które te dane zawierają.

Podgląd online jest zawsze w PDF; formaty do pobrania ustawia administrator w szablonie.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import crypto, storage, templating
from app.audit import audit
from app.config import get_settings
from app.deps import AdminAuth, AuthContext, DbSession, require_roles
from app.models import DocumentTemplate, GeneratedDocument, Role, User
from app.routers.employees import format_number, get_visible
from app.templating import FieldDef, TemplateError

router = APIRouter(prefix="/api", tags=["documents"])

DocAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr, Role.manager))]
MAX_TEMPLATE_MB = 10
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
LANGUAGES = {"pl", "en", "uk", "ru", "de", "es", "ro", "hi", "ne"}


# ---------- schematy ----------


DownloadFormats = Literal["pdf", "docx", "both"]


class BuiltinOut(BaseModel):
    key: str
    label: str


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    language: str
    version: int
    original_filename: str
    variables: list[str]
    builtins: list[str]
    fields: list[FieldDef]
    sensitive: bool
    allow_manager: bool
    download_formats: DownloadFormats
    strict_pdf: bool
    is_active: bool
    updated_at: datetime


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    language: str | None = None
    is_active: bool | None = None
    allow_manager: bool | None = None
    download_formats: DownloadFormats | None = None
    strict_pdf: bool | None = None
    fields: list[FieldDef] | None = None


class GenerateIn(BaseModel):
    template_id: int
    values: dict[str, Any] = Field(default_factory=dict)
    # PESEL wpisany przy generowaniu, gdy pracownik go nie ma – zapisywany w kartotece
    pesel: str | None = Field(default=None, max_length=20)


class FormatOut(BaseModel):
    value: str
    label: str
    mask: str


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: int | None
    template_name: str
    template_version: int
    has_pdf: bool
    created_by_name: str | None
    created_at: datetime
    contains_sensitive: bool
    # Wyliczane dla bieżącego użytkownika:
    accessible: bool = True
    can_view: bool = False
    can_delete: bool = False
    download: list[str] = Field(default_factory=list)
    masked: bool = False
    pdf_error: str | None = None
    signature_roles: list[str] = Field(default_factory=list)
    signed_at: datetime | None = None
    has_signed_pdf: bool = False
    signature_pending: bool = False


# ---------- pliki ----------


def _dir(name: str) -> Path:
    p = Path(get_settings().data_dir) / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def _template_path(t: DocumentTemplate) -> Path:
    return _dir("templates") / t.file_name


def _doc_path(d: GeneratedDocument, ext: str) -> Path:
    return _dir(f"documents/{d.employee_id}") / f"{d.id}.{ext}"


async def _read_docx(file: UploadFile) -> bytes:
    limit = MAX_TEMPLATE_MB * 1024 * 1024
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik jest za duży.")
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Szablon musi być plikiem Word .docx.")
    return raw


def _out(t: DocumentTemplate) -> TemplateOut:
    return TemplateOut(
        id=t.id,
        name=t.name,
        description=t.description,
        language=t.language,
        version=t.version,
        original_filename=t.original_filename,
        variables=t.variables,
        builtins=[v for v in t.variables if v in templating.BUILTINS],
        fields=[FieldDef.model_validate(f) for f in t.fields],
        sensitive=t.sensitive,
        allow_manager=t.allow_manager,
        download_formats=t.download_formats,  # type: ignore[arg-type]
        strict_pdf=t.strict_pdf,
        is_active=t.is_active,
        updated_at=t.updated_at,
    )


def _get_template(db: Session, template_id: int) -> DocumentTemplate:
    t = db.get(DocumentTemplate, template_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono szablonu.")
    return t


def _check_language(lang: str) -> str:
    lang = lang.strip().lower()
    if lang not in LANGUAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Nieobsługiwany język: {lang}")
    return lang


# ---------- szablony ----------


@router.get("/templates/formats", response_model=list[FormatOut])
def field_formats(ctx: DocAuth) -> list[FormatOut]:
    from app.masks import PRESETS

    return [FormatOut(value=k, label=v["label"], mask=v["mask"]) for k, v in PRESETS.items()]


@router.get("/templates/builtins", response_model=list[BuiltinOut])
def builtins(ctx: DocAuth) -> list[BuiltinOut]:
    return [BuiltinOut(key=k, label=v) for k, v in templating.BUILTINS.items()]


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(ctx: DocAuth, db: DbSession, active_only: bool = False) -> list[TemplateOut]:
    q = select(DocumentTemplate).order_by(func.lower(DocumentTemplate.name))
    if active_only or ctx.user.role != Role.admin:
        q = q.where(DocumentTemplate.is_active)
    if ctx.user.role == Role.manager:
        q = q.where(DocumentTemplate.allow_manager)
    return [_out(t) for t in db.scalars(q)]


@router.post("/templates", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    ctx: AdminAuth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
    name: Annotated[str, Form(min_length=1, max_length=200)],
    language: Annotated[str, Form()] = "pl",
    description: Annotated[str | None, Form(max_length=1000)] = None,
) -> TemplateOut:
    raw = await _read_docx(file)
    try:
        analysis = templating.analyze(raw)
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    t = DocumentTemplate(
        name=name.strip(),
        description=(description or "").strip() or None,
        language=_check_language(language),
        version=1,
        file_name="pending",
        original_filename=(file.filename or "szablon.docx")[:255],
        variables=analysis.variables,
        fields=[f.model_dump() for f in analysis.fields],
        sensitive=analysis.sensitive,
        is_active=True,
    )
    db.add(t)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Szablon o tej nazwie już istnieje.") from exc
    t.file_name = f"{t.id}_v1.docx"
    _template_path(t).write_bytes(raw)
    audit(
        db,
        request,
        "template_created",
        user=ctx.user,
        entity_type="template",
        entity_id=t.id,
        details={"name": t.name, "fields": len(analysis.fields)},
    )
    db.commit()
    db.refresh(t)
    return _out(t)


@router.get("/templates/{template_id}", response_model=TemplateOut)
def get_template(template_id: int, ctx: AdminAuth, db: DbSession) -> TemplateOut:
    return _out(_get_template(db, template_id))


@router.patch("/templates/{template_id}", response_model=TemplateOut)
def update_template(
    template_id: int, body: TemplatePatch, ctx: AdminAuth, request: Request, db: DbSession
) -> TemplateOut:
    t = _get_template(db, template_id)
    changes: list[str] = []
    if body.name is not None and body.name.strip() != t.name:
        t.name = body.name.strip()
        changes.append("name")
    if "description" in body.model_fields_set:
        t.description = (body.description or "").strip() or None
        changes.append("description")
    if body.language is not None:
        t.language = _check_language(body.language)
        changes.append("language")
    if body.is_active is not None and body.is_active != t.is_active:
        t.is_active = body.is_active
        changes.append("is_active")
    if body.allow_manager is not None and body.allow_manager != t.allow_manager:
        t.allow_manager = body.allow_manager
        changes.append("allow_manager")
    if body.download_formats is not None and body.download_formats != t.download_formats:
        t.download_formats = body.download_formats
        changes.append("download_formats")
    if body.strict_pdf is not None and body.strict_pdf != t.strict_pdf:
        t.strict_pdf = body.strict_pdf
        changes.append("strict_pdf")
    if body.fields is not None:
        allowed = set(t.variables) - set(templating.BUILTINS)
        keys = [f.key for f in body.fields]
        if len(keys) != len(set(keys)):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Pola się powtarzają.")
        unknown = set(keys) - allowed
        if unknown:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail=f"Szablon nie zawiera znaczników: {sorted(unknown)}"
            )
        for f in body.fields:
            if f.type == "select" and not f.options:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, detail=f"Pole „{f.label}” (lista) nie ma opcji do wyboru."
                )
        t.fields = [f.model_dump() for f in body.fields]
        changes.append("fields")
    if changes:
        audit(
            db,
            request,
            "template_updated",
            user=ctx.user,
            entity_type="template",
            entity_id=t.id,
            details={"name": t.name, "changed": changes},
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Szablon o tej nazwie już istnieje.") from exc
    db.refresh(t)
    return _out(t)


@router.put("/templates/{template_id}/file", response_model=TemplateOut)
async def replace_template_file(
    template_id: int,
    ctx: AdminAuth,
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File()],
) -> TemplateOut:
    t = _get_template(db, template_id)
    raw = await _read_docx(file)
    try:
        analysis = templating.analyze(raw)
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    existing = [FieldDef.model_validate(f) for f in t.fields]
    t.version += 1
    t.file_name = f"{t.id}_v{t.version}.docx"  # poprzednie wersje zostają na dysku
    t.original_filename = (file.filename or "szablon.docx")[:255]
    t.variables = analysis.variables
    t.fields = [f.model_dump() for f in templating.merge_fields(existing, analysis.fields)]
    t.sensitive = analysis.sensitive
    _template_path(t).write_bytes(raw)
    audit(
        db,
        request,
        "template_file_replaced",
        user=ctx.user,
        entity_type="template",
        entity_id=t.id,
        details={"name": t.name, "version": t.version},
    )
    db.commit()
    db.refresh(t)
    return _out(t)


@router.get("/templates/{template_id}/file")
def download_template(template_id: int, ctx: AdminAuth, db: DbSession) -> Response:
    t = _get_template(db, template_id)
    name = templating.safe_filename(t.name) + ".docx"
    return Response(
        _template_path(t).read_bytes(),
        media_type=DOCX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ---------- dokumenty pracownika ----------


def _check_template_access(user: User, t: DocumentTemplate) -> None:
    if user.role == Role.manager and not t.allow_manager:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Ten szablon jest dostępny tylko dla Administratora i Kadr.",
        )


def _allowed_formats(t: DocumentTemplate | None, doc: GeneratedDocument) -> list[str]:
    setting = t.download_formats if t is not None else "both"
    formats = ["pdf", "docx"] if setting == "both" else [setting]
    # Gdy PDF nie powstał (brak LibreOffice), zostaje Word – żeby dokument nie był bezużyteczny.
    if "pdf" in formats and not doc.has_pdf:
        formats = [f for f in formats if f != "pdf"] or ["docx"]
    return formats


def _doc_out(doc: GeneratedDocument, t: DocumentTemplate | None, user: User) -> DocumentOut:
    out = DocumentOut.model_validate(doc)
    out.accessible = not (user.role == Role.manager and doc.contains_sensitive)
    out.can_view = out.accessible and (doc.has_pdf or doc.signed_at is not None)
    out.download = _allowed_formats(t, doc) if out.accessible and user.role != Role.manager else []
    out.can_delete = can_delete(doc, user)
    return out


def forbid_download(user: User) -> None:
    """Kierownik ogląda dokumenty tylko w podglądzie – bez pobierania plików."""
    if user.role == Role.manager:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Kierownik nie może pobierać dokumentów – użyj podglądu."
        )


def can_delete(doc: GeneratedDocument, user: User) -> bool:
    """Kadry i admin – każdy dokument; kierownik – tylko własny, jeszcze niepodpisany."""
    if user.role in (Role.admin, Role.hr):
        return True
    return (
        user.role == Role.manager
        and doc.created_by == user.id
        and not doc.contains_sensitive
        and doc.signed_at is None
        and not doc.has_signed_pdf
    )


TRASH_DAYS = 30


def _get_doc(
    db: Session, user: User, document_id: uuid.UUID, trashed: bool = False
) -> tuple[GeneratedDocument, Any, Any]:
    doc = db.get(GeneratedDocument, document_id)
    if doc is None or (doc.deleted_at is not None) != trashed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono dokumentu.")
    e = get_visible(db, user, doc.employee_id)
    if user.role == Role.manager and doc.contains_sensitive:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Dokument zawiera PESEL lub datę urodzenia – brak dostępu."
        )
    t = db.get(DocumentTemplate, doc.template_id) if doc.template_id else None
    return doc, e, t


@router.get("/employees/{employee_id}/documents", response_model=list[DocumentOut])
def list_documents(employee_id: int, ctx: DocAuth, db: DbSession) -> list[DocumentOut]:
    get_visible(db, ctx.user, employee_id)
    docs = list(
        db.scalars(
            select(GeneratedDocument)
            .where(GeneratedDocument.employee_id == employee_id, GeneratedDocument.deleted_at.is_(None))
            .order_by(GeneratedDocument.created_at.desc())
        )
    )
    templates = {t.id: t for t in db.scalars(select(DocumentTemplate))}
    from app.models import DocumentSignature

    pending = set(
        db.scalars(
            select(DocumentSignature.document_id).where(
                DocumentSignature.document_id.in_([d.id for d in docs]),
                DocumentSignature.status == "pending",
                DocumentSignature.expires_at > func.now(),
            )
        )
    )
    out = [_doc_out(d, templates.get(d.template_id or 0), ctx.user) for d in docs]
    for o in out:
        o.signature_pending = o.id in pending
    return out


class _Generated:
    def __init__(
        self, doc: GeneratedDocument, docx: bytes, pdf: bytes | None, pdf_error: str | None, masked: bool
    ):
        self.doc, self.docx, self.pdf, self.pdf_error, self.masked = doc, docx, pdf, pdf_error, masked


def _usable_template(db: Session, user: User, template_id: int) -> DocumentTemplate:
    t = _get_template(db, template_id)
    if not t.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Szablon jest wyłączony.")
    _check_template_access(user, t)
    return t


def _save_missing_pesel(db: Session, request: Request, user: User, e: Any, pesel: str) -> None:
    """PESEL wpisany przy generowaniu dokumentu trafia do kartoteki (z pełną walidacją)."""
    from app.routers.employees import _assign, _check_duplicates, _validate, full_access

    if not full_access(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień do wpisania numeru PESEL.")
    if e.pesel_enc is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Pracownik ma już wpisany PESEL.")
    data = _validate(db, e, {"pesel": pesel}, creating=False)
    pesel_hash = _check_duplicates(db, e, data, confirm=True)
    changes = _assign(e, data, pesel_hash)
    audit(
        db,
        request,
        "employee_updated",
        user=user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "changes": changes, "source": "dokument"},
    )
    db.flush()


def _contact(e: Any, user: User) -> dict[str, str]:
    """Zweryfikowany kontakt pracownika – tylko dla administratora i kadr."""
    if user.role not in (Role.admin, Role.hr):
        return {}
    out: dict[str, str] = {}
    try:
        if e.email_enc:
            out["email"] = crypto.decrypt_contact(e.email_enc)
        if e.phone_enc:
            out["phone"] = crypto.decrypt_contact(e.phone_enc)
    except ValueError:
        pass
    return out


def _create_document(
    db: Session,
    request: Request,
    user: User,
    e: Any,
    t: DocumentTemplate,
    raw_values: dict[str, Any],
    pesel_input: str | None = None,
    training: Any = None,
) -> _Generated:
    """Wypełnia szablon dla jednej osoby, zapisuje pliki i wpis w historii (bez commita)."""
    masked = user.role == Role.manager and t.sensitive
    fields = [FieldDef.model_validate(f) for f in t.fields]
    contact = _contact(e, user)
    raw_values = dict(raw_values)
    for f in fields:  # puste pola „e-mail” / „telefon” uzupełniamy z kartoteki
        kind = templating.contact_kind(f.key)
        if kind and contact.get(kind) and not str(raw_values.get(f.key) or "").strip():
            raw_values[f.key] = contact[kind]
    values = templating.form_values(fields, raw_values)  # TemplateError → obsługuje wywołujący
    if pesel_input and pesel_input.strip():
        _save_missing_pesel(db, request, user, e, pesel_input)

    uses_pesel = "pesel" in t.variables
    pesel = crypto.decrypt(e.pesel_enc) if (uses_pesel and e.pesel_enc and not masked) else None
    builtin = templating.builtin_values(e, pesel, training=training, contact=contact)
    if masked:
        builtin |= {k: "" for k in templating.SENSITIVE}
    context = {v: "" for v in t.variables} | builtin | values
    docx = templating.render_docx(_template_path(t).read_bytes(), context)

    doc = GeneratedDocument(
        id=uuid.uuid4(),
        employee_id=e.id,
        template_id=t.id,
        template_name=t.name,
        template_version=t.version,
        created_by=user.id,
        created_by_name=user.full_name,
        contains_sensitive=t.sensitive and not masked,
    )
    doc.signature_roles = templating.signature_roles(t.variables)
    storage.write(_doc_path(doc, "docx"), docx)
    pdf_error, pdf = None, None
    # PDF powstaje zawsze, gdy się da – służy do podglądu online.
    try:
        pdf = templating.to_pdf(docx)
        storage.write(_doc_path(doc, "pdf"), pdf)
        doc.has_pdf = True
    except templating.PdfUnavailable as exc:
        pdf_error = str(exc)
    db.add(doc)
    audit(
        db,
        request,
        "document_generated",
        user=user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "template": t.name,
            "version": t.version,
            "contains_pesel": bool(pesel),
            "masked": masked,
            **({"training_id": training.id} if training is not None else {}),
        },
    )
    return _Generated(doc, docx, pdf, pdf_error, masked)


@router.post(
    "/employees/{employee_id}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED
)
def generate(
    employee_id: int, body: GenerateIn, ctx: DocAuth, request: Request, db: DbSession
) -> DocumentOut:
    e = get_visible(db, ctx.user, employee_id)
    t = _usable_template(db, ctx.user, body.template_id)
    try:
        g = _create_document(db, request, ctx.user, e, t, body.values, body.pesel)
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    db.commit()
    db.refresh(g.doc)
    out = _doc_out(g.doc, t, ctx.user)
    out.masked = g.masked
    out.pdf_error = g.pdf_error
    return out


MAX_BATCH = 50


class BatchItem(BaseModel):
    employee_id: int
    values: dict[str, Any] = Field(default_factory=dict)
    pesel: str | None = Field(default=None, max_length=20)


class BatchIn(BaseModel):
    template_id: int
    format: Literal["pdf", "docx"] = "pdf"
    items: list[BatchItem] = Field(min_length=1, max_length=MAX_BATCH)


@router.post("/documents/batch")
def generate_batch(body: BatchIn, ctx: DocAuth, request: Request, db: DbSession) -> Response:
    forbid_download(ctx.user)
    """Ten sam dokument dla kilku osób naraz – paczka ZIP (każda osoba może mieć własne wartości pól)."""
    import io
    import zipfile

    t = _usable_template(db, ctx.user, body.template_id)
    allowed = ["pdf", "docx"] if t.download_formats == "both" else [t.download_formats]
    if body.format not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ten format nie jest dostępny dla szablonu.")
    ids = [it.employee_id for it in body.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ta sama osoba występuje dwa razy.")
    people = [(get_visible(db, ctx.user, it.employee_id), it.values, it.pesel) for it in body.items]

    buf = io.BytesIO()
    names: set[str] = set()
    created: list[GeneratedDocument] = []

    def fail(code: int, detail: str) -> HTTPException:
        db.rollback()
        for d in created:  # pliki osób wygenerowanych przed błędem
            for ext in ("docx", "pdf"):
                _doc_path(d, ext).unlink(missing_ok=True)
        return HTTPException(code, detail=detail)

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for e, values, pesel_input in people:
            who = f"{format_number(e.number)} {e.last_name} {e.first_name}"
            try:
                g = _create_document(db, request, ctx.user, e, t, values, pesel_input)
            except TemplateError as exc:
                raise fail(status.HTTP_400_BAD_REQUEST, f"{who}: {exc}") from exc
            except HTTPException as exc:
                msg = exc.detail.get("message") if isinstance(exc.detail, dict) else exc.detail
                raise fail(exc.status_code, f"{who}: {msg}") from exc
            created.append(g.doc)
            content, ext = (g.pdf, "pdf") if body.format == "pdf" and g.pdf else (g.docx, "docx")
            if body.format == "pdf" and g.pdf is None:
                raise fail(
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    f"Nie udało się utworzyć PDF ({g.pdf_error}). Wybierz format Word.",
                )
            name = templating.safe_filename(f"{who} {t.name}") + f".{ext}"
            n = 2
            while name in names:
                name = templating.safe_filename(f"{who} {t.name} {n}") + f".{ext}"
                n += 1
            names.add(name)
            zf.writestr(name, content)
    audit(
        db,
        request,
        "documents_batch_generated",
        user=ctx.user,
        entity_type="template",
        entity_id=t.id,
        details={"template": t.name, "count": len(people), "format": body.format},
    )
    db.commit()
    zip_name = templating.safe_filename(f"{t.name} {len(people)} os {datetime.now():%Y-%m-%d}") + ".zip"
    return Response(
        buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"', "Cache-Control": "no-store"},
    )


@router.get("/documents/{document_id}/download")
def download_document(
    document_id: uuid.UUID,
    ctx: DocAuth,
    request: Request,
    db: DbSession,
    format: Literal["pdf", "docx"] = "pdf",
) -> Response:
    forbid_download(ctx.user)
    doc, e, t = _get_doc(db, ctx.user, document_id)
    if format not in _allowed_formats(t, doc) and not (format == "pdf" and doc.signed_at):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Ten dokument nie jest dostępny do pobrania jako {format.upper()}.",
        )
    from app.routers.signatures import signed_file

    path, ext, media = _doc_path(doc, format), format, "application/pdf" if format == "pdf" else DOCX_MIME
    # PDF podpisanego dokumentu = wersja z podpisami (albo skan); Word zostaje oryginałem do edycji
    signed = signed_file(db, doc) if format == "pdf" and (doc.has_signed_pdf or doc.signed_at) else None
    if signed:
        path, ext, media = signed
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku dokumentu.")
    audit(
        db,
        request,
        "document_downloaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "template": doc.template_name,
            "format": "signed" if signed else format,
        },
    )
    db.commit()
    suffix = "_podpisany" if signed else ""
    name = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}{suffix}") + f".{ext}"
    return Response(
        storage.read(path),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


class EmailIn(BaseModel):
    to: str | None = Field(default=None, max_length=254)  # domyślnie potwierdzony e-mail pracownika
    message: str | None = Field(default=None, max_length=1000)


class EmailOut(BaseModel):
    sent_to: str


MAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_MAILS_PER_HOUR = 20


@router.post("/documents/{document_id}/email", response_model=EmailOut)
def email_document(
    document_id: uuid.UUID, body: EmailIn, ctx: DocAuth, request: Request, db: DbSession
) -> EmailOut:
    """Wysyła dokument (podpisany, jeśli jest) jako załącznik e-mailem – do pracownika lub na podany adres."""
    from app import mailer
    from app.emails import Email
    from app.models import AuditLog
    from app.routers.signatures import _contact_of, signed_file

    forbid_download(ctx.user)
    doc, e, t = _get_doc(db, ctx.user, document_id)
    to = (body.to or "").strip() or _contact_of(e).get("email", "")
    if not to:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Pracownik nie ma potwierdzonego e-maila – wpisz adres, na który wysłać dokument.",
        )
    if not MAIL_RE.match(to):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Podaj poprawny adres e-mail.")
    if not (mailer.enabled() or mailer.outbox is not None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wysyłka e-maili nie jest skonfigurowana.")
    recent = db.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.action == "document_emailed",
            AuditLog.user_id == ctx.user.id,
            AuditLog.ts > datetime.now(UTC) - timedelta(hours=1),
        )
    )
    if (recent or 0) >= MAX_MAILS_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Za dużo wysłanych dokumentów – spróbuj za godzinę."
        )
    signed = signed_file(db, doc) if (doc.has_signed_pdf or doc.signed_at) else None
    if signed:
        path, ext, mime = signed
    else:
        fmt = "pdf" if "pdf" in _allowed_formats(t, doc) and doc.has_pdf else "docx"
        path, ext, mime = _doc_path(doc, fmt), fmt, "application/pdf" if fmt == "pdf" else DOCX_MIME
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku dokumentu.")
    name = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}") + f".{ext}"
    note = (body.message or "").strip()
    mail = Email(
        subject=f"Dokument: {doc.template_name}",
        title="Dokument w załączniku",
        greeting=f"Dzień dobry {e.first_name}," if to == _contact_of(e).get("email") else "Dzień dobry,",
        paragraphs=[f"w załączniku przesyłamy dokument „{doc.template_name}”."] + ([note] if note else []),
        footer_note=f"Wysłał(-a): {ctx.user.full_name}.",
        attachments=[(name, storage.read(path), mime)],
    )
    try:
        if mailer.outbox is not None:
            mailer.outbox.append((to, mail.subject, mail.text()))
        else:
            mailer.send_now(to, mail)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="Nie udało się wysłać e-maila.") from exc
    masked = f"{to.split('@')[0][:2]}***@{to.split('@')[1]}"
    audit(
        db,
        request,
        "document_emailed",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "template": doc.template_name,
            "to": masked,
            "signed": bool(signed),
        },
    )
    db.commit()
    return EmailOut(sent_to=masked)


def _view_source(db: Session, doc: GeneratedDocument) -> tuple[bytes, str, bool, bool]:
    """Plik do podglądu: (dane, rozszerzenie, czy wersja podpisana, czy to plik z podpisem zaufanym).

    Wersja podpisana: plik z gov.pl (PDF albo dokument zaszyty w XML), PDF z podpisami z ekranu, skan.
    """
    from app import signing
    from app.routers.signatures import signed_file

    signed = signed_file(db, doc) if (doc.has_signed_pdf or doc.signed_at) else None
    if signed and signed[1] == "xml":
        inner = signing.embedded_pdf(storage.read(signed[0]))
        if inner:
            return inner, "pdf", True, True
        stamped = _doc_path(doc, "pdf").with_name(f"{doc.id}_signed.pdf")
        if stamped.exists():
            return storage.read(stamped), "pdf", True, False
        signed = None
    if signed:
        path, ext, _ = signed
        return (
            storage.read(path),
            ext,
            True,
            path.name != f"{doc.id}_signed.pdf" and ext == "pdf" and "_sig_" in path.name,
        )
    path = _doc_path(doc, "pdf")
    if not doc.has_pdf or not path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Podgląd niedostępny – dokument nie ma wersji PDF."
        )
    return storage.read(path), "pdf", False, False


def _audit_view(
    db: Session, request: Request, user: User, doc: GeneratedDocument, e: Any, signed: bool
) -> None:
    audit(
        db,
        request,
        "document_viewed",
        user=user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "template": doc.template_name,
            **({"version": "podpisany"} if signed else {}),
        },
    )
    db.commit()


class PreviewOut(BaseModel):
    pages: int
    signed: bool
    title: str


def _preview_parts(db: Session, doc: GeneratedDocument) -> tuple[list[tuple[bytes, str]], bool]:
    """Pliki składające się na podgląd: dokument + (dla podpisu zaufanego) strona potwierdzenia."""
    from app.routers.signatures import preview_extra

    data, ext, signed, trusted = _view_source(db, doc)
    parts = [(data, ext)]
    extra = preview_extra(db, doc) if trusted else None
    if extra:  # podpis zaufany jest w pliku niewidoczny – dokładamy stronę potwierdzenia
        parts.append((extra, "pdf"))
    return parts, signed


@router.get("/documents/{document_id}/preview", response_model=PreviewOut)
def preview_document(document_id: uuid.UUID, ctx: DocAuth, request: Request, db: DbSession) -> PreviewOut:
    """Podgląd w aplikacji: liczba stron (strony pobiera się jako obrazy ze znakiem wodnym)."""
    from app import preview

    doc, e, _ = _get_doc(db, ctx.user, document_id)
    parts, signed = _preview_parts(db, doc)
    pages = sum(preview.page_count(d, x) for d, x in parts)
    _audit_view(db, request, ctx.user, doc, e, signed)
    return PreviewOut(pages=pages, signed=signed, title=f"{doc.template_name} – {e.last_name} {e.first_name}")


@router.get("/documents/{document_id}/preview/{page}")
def preview_page(document_id: uuid.UUID, page: int, ctx: DocAuth, db: DbSession) -> Response:
    from app import preview

    doc, _, _ = _get_doc(db, ctx.user, document_id)
    parts, _ = _preview_parts(db, doc)
    viewer = ctx.user.full_name or ctx.user.username
    for data, ext in parts:
        n = preview.page_count(data, ext)
        if 0 <= page < n:
            png = preview.render_page(data, ext, page, viewer)
            return Response(png, media_type="image/png", headers={"Cache-Control": "no-store, private"})
        page -= n
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie ma takiej strony.")


@router.get("/documents/{document_id}/view")
def view_document(document_id: uuid.UUID, ctx: DocAuth, request: Request, db: DbSession) -> Response:
    """Plik PDF w przeglądarce – tylko kadry i admin (kierownik ma podgląd w aplikacji)."""
    forbid_download(ctx.user)
    doc, e, _ = _get_doc(db, ctx.user, document_id)
    data, ext, signed, _ = _view_source(db, doc)
    _audit_view(db, request, ctx.user, doc, e, signed)
    media = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}[ext]
    suffix = "_podpisany" if signed else ""
    name = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}{suffix}") + f".{ext}"
    return Response(
        data,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{name}"', "Cache-Control": "no-store"},
    )


class DeleteIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class TrashedOut(BaseModel):
    id: uuid.UUID
    template_name: str
    created_at: datetime
    deleted_at: datetime
    deleted_by_name: str | None
    delete_reason: str | None
    purge_at: datetime
    can_restore: bool


@router.get("/employees/{employee_id}/documents/trash", response_model=list[TrashedOut])
def list_trash(employee_id: int, ctx: DocAuth, db: DbSession) -> list[TrashedOut]:
    get_visible(db, ctx.user, employee_id)
    rows = db.scalars(
        select(GeneratedDocument)
        .where(GeneratedDocument.employee_id == employee_id, GeneratedDocument.deleted_at.is_not(None))
        .order_by(GeneratedDocument.deleted_at.desc())
    )
    return [
        TrashedOut(
            id=d.id,
            template_name=d.template_name,
            created_at=d.created_at,
            deleted_at=d.deleted_at,
            deleted_by_name=d.deleted_by_name,
            delete_reason=d.delete_reason,
            purge_at=d.deleted_at + timedelta(days=TRASH_DAYS),
            can_restore=can_delete(d, ctx.user),
        )
        for d in rows
        if not (ctx.user.role == Role.manager and d.contains_sensitive)
    ]


@router.post("/documents/{document_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_document(document_id: uuid.UUID, ctx: DocAuth, request: Request, db: DbSession) -> Response:
    doc, e, _ = _get_doc(db, ctx.user, document_id, trashed=True)
    if not can_delete(doc, ctx.user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Nie możesz przywrócić tego dokumentu.")
    doc.deleted_at = doc.deleted_by_name = doc.delete_reason = None
    audit(
        db,
        request,
        "document_restored",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "template": doc.template_name},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def purge_trash(db: Session) -> int:
    """Trwale usuwa dokumenty, które leżą w koszu dłużej niż TRASH_DAYS (pliki i wiersze)."""
    cutoff = datetime.now(UTC) - timedelta(days=TRASH_DAYS)
    n = 0
    for doc in list(
        db.scalars(
            select(GeneratedDocument).where(
                GeneratedDocument.deleted_at.is_not(None), GeneratedDocument.deleted_at < cutoff
            )
        )
    ):
        files = list(_dir(f"documents/{doc.employee_id}").glob(f"{doc.id}*"))
        audit(
            db,
            None,
            "document_deleted",
            username="system",
            entity_type="employee",
            entity_id=doc.employee_id,
            details={"template": doc.template_name, "purged_from_trash": True},
        )
        db.delete(doc)
        db.commit()
        for f in files:
            f.unlink(missing_ok=True)
        n += 1
    return n


@router.post("/documents/{document_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: uuid.UUID, body: DeleteIn, ctx: DocAuth, request: Request, db: DbSession
) -> Response:
    """Usunięcie dokumentu (np. wygenerowanego przez pomyłkę): trafia do kosza na 30 dni."""
    from app.models import DocumentSignature

    doc, e, _ = _get_doc(db, ctx.user, document_id)
    if not can_delete(doc, ctx.user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Możesz usunąć tylko własny dokument, który nie został jeszcze podpisany.",
        )
    signed = doc.signed_at is not None or doc.has_signed_pdf
    n_sig = len(
        list(
            db.scalars(
                select(DocumentSignature.id).where(
                    DocumentSignature.document_id == doc.id, DocumentSignature.status == "signed"
                )
            )
        )
    )
    audit(
        db,
        request,
        "document_trashed",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "template": doc.template_name,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "signed": signed,
            "signatures": n_sig,
            "reason": body.reason.strip(),
        },
    )
    doc.deleted_at, doc.deleted_by_name = datetime.now(UTC), ctx.user.full_name
    doc.delete_reason = body.reason.strip()
    for sg in db.scalars(
        select(DocumentSignature).where(
            DocumentSignature.document_id == doc.id, DocumentSignature.status == "pending"
        )
    ):
        sg.status, sg.token_hash = "cancelled", None  # prośby o podpis przestają działać
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
