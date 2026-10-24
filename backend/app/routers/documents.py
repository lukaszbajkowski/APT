"""Szablony dokumentów (Administrator) i dokumenty generowane dla pracowników.

Generować mogą Administrator, Kadry i Kierownik (w swoim zakresie, tylko szablony z włączonym
„dostępny dla kierownika”). Kierownik dostaje dokument bez PESEL i daty urodzenia (puste pola)
i nie ma dostępu do dokumentów, które te dane zawierają.

Podgląd online jest zawsze w PDF; formaty do pobrania ustawia administrator w szablonie.
"""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import crypto, templating
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
    is_active: bool
    updated_at: datetime


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    language: str | None = None
    is_active: bool | None = None
    allow_manager: bool | None = None
    download_formats: DownloadFormats | None = None
    fields: list[FieldDef] | None = None


class GenerateIn(BaseModel):
    template_id: int
    values: dict[str, Any] = Field(default_factory=dict)


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
    download: list[str] = Field(default_factory=list)
    masked: bool = False
    pdf_error: str | None = None


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
    out.can_view = out.accessible and doc.has_pdf
    out.download = _allowed_formats(t, doc) if out.accessible else []
    return out


def _get_doc(db: Session, user: User, document_id: uuid.UUID) -> tuple[GeneratedDocument, Any, Any]:
    doc = db.get(GeneratedDocument, document_id)
    if doc is None:
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
            .where(GeneratedDocument.employee_id == employee_id)
            .order_by(GeneratedDocument.created_at.desc())
        )
    )
    templates = {t.id: t for t in db.scalars(select(DocumentTemplate))}
    return [_doc_out(d, templates.get(d.template_id or 0), ctx.user) for d in docs]


@router.post(
    "/employees/{employee_id}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED
)
def generate(
    employee_id: int, body: GenerateIn, ctx: DocAuth, request: Request, db: DbSession
) -> DocumentOut:
    e = get_visible(db, ctx.user, employee_id)
    t = _get_template(db, body.template_id)
    if not t.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Szablon jest wyłączony.")
    _check_template_access(ctx.user, t)
    masked = ctx.user.role == Role.manager and t.sensitive

    fields = [FieldDef.model_validate(f) for f in t.fields]
    try:
        values = templating.form_values(fields, body.values)
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    uses_pesel = "pesel" in t.variables
    pesel = crypto.decrypt(e.pesel_enc) if (uses_pesel and e.pesel_enc and not masked) else None
    builtin = templating.builtin_values(e, pesel)
    if masked:
        builtin |= {k: "" for k in templating.SENSITIVE}
    context = {v: "" for v in t.variables} | builtin | values
    try:
        docx = templating.render_docx(_template_path(t).read_bytes(), context)
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    doc = GeneratedDocument(
        id=uuid.uuid4(),
        employee_id=e.id,
        template_id=t.id,
        template_name=t.name,
        template_version=t.version,
        created_by=ctx.user.id,
        created_by_name=ctx.user.full_name,
        contains_sensitive=t.sensitive and not masked,
    )
    _doc_path(doc, "docx").write_bytes(docx)
    pdf_error = None
    # PDF powstaje zawsze, gdy się da – służy do podglądu online.
    try:
        _doc_path(doc, "pdf").write_bytes(templating.to_pdf(docx))
        doc.has_pdf = True
    except templating.PdfUnavailable as exc:
        pdf_error = str(exc)
    db.add(doc)
    audit(
        db,
        request,
        "document_generated",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={
            "number": format_number(e.number),
            "template": t.name,
            "version": t.version,
            "contains_pesel": bool(pesel),
            "masked": masked,
        },
    )
    db.commit()
    db.refresh(doc)
    out = _doc_out(doc, t, ctx.user)
    out.masked = masked
    out.pdf_error = pdf_error
    return out


@router.get("/documents/{document_id}/download")
def download_document(
    document_id: uuid.UUID,
    ctx: DocAuth,
    request: Request,
    db: DbSession,
    format: Literal["pdf", "docx"] = "pdf",
) -> Response:
    doc, e, t = _get_doc(db, ctx.user, document_id)
    if format not in _allowed_formats(t, doc):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Ten dokument nie jest dostępny do pobrania jako {format.upper()}.",
        )
    path = _doc_path(doc, format)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Brak pliku dokumentu.")
    audit(
        db,
        request,
        "document_downloaded",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "template": doc.template_name, "format": format},
    )
    db.commit()
    name = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}") + f".{format}"
    return Response(
        path.read_bytes(),
        media_type="application/pdf" if format == "pdf" else DOCX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


@router.get("/documents/{document_id}/view")
def view_document(document_id: uuid.UUID, ctx: DocAuth, request: Request, db: DbSession) -> Response:
    """Podgląd online (PDF w przeglądarce). Każde otwarcie trafia do dziennika."""
    doc, e, _ = _get_doc(db, ctx.user, document_id)
    path = _doc_path(doc, "pdf")
    if not doc.has_pdf or not path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Podgląd niedostępny – dokument nie ma wersji PDF."
        )
    audit(
        db,
        request,
        "document_viewed",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"number": format_number(e.number), "template": doc.template_name},
    )
    db.commit()
    name = templating.safe_filename(f"{doc.template_name}_{e.last_name}_{e.first_name}") + ".pdf"
    return Response(
        path.read_bytes(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{name}"', "Cache-Control": "no-store"},
    )
