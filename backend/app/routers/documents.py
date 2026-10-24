"""Szablony dokumentów (Administrator) i dokumenty generowane dla pracowników.

Generować mogą Administrator, Kadry i Kierownik (w swoim zakresie). Kierownik nie może używać szablonów
z danymi wrażliwymi (PESEL, data urodzenia), bo sam tych danych nie widzi.
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
    is_active: bool
    updated_at: datetime


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    language: str | None = None
    is_active: bool | None = None
    fields: list[FieldDef] | None = None


class GenerateIn(BaseModel):
    template_id: int
    values: dict[str, Any] = Field(default_factory=dict)
    pdf: bool = True


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: int | None
    template_name: str
    template_version: int
    has_pdf: bool
    created_by_name: str | None
    created_at: datetime
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
        q = q.where(DocumentTemplate.sensitive.is_(False))
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


def _check_doc_access(user: User, t: DocumentTemplate) -> None:
    if user.role == Role.manager and t.sensitive:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Ten szablon zawiera PESEL lub datę urodzenia – mogą go użyć tylko Administrator i Kadry.",
        )


@router.get("/employees/{employee_id}/documents", response_model=list[DocumentOut])
def list_documents(employee_id: int, ctx: DocAuth, db: DbSession) -> list[GeneratedDocument]:
    get_visible(db, ctx.user, employee_id)
    return list(
        db.scalars(
            select(GeneratedDocument)
            .where(GeneratedDocument.employee_id == employee_id)
            .order_by(GeneratedDocument.created_at.desc())
        )
    )


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
    _check_doc_access(ctx.user, t)

    fields = [FieldDef.model_validate(f) for f in t.fields]
    try:
        values = templating.form_values(fields, body.values)
    except TemplateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    uses_pesel = "pesel" in t.variables
    pesel = crypto.decrypt(e.pesel_enc) if (uses_pesel and e.pesel_enc) else None
    context = {v: "" for v in t.variables} | templating.builtin_values(e, pesel) | values
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
    )
    _doc_path(doc, "docx").write_bytes(docx)
    pdf_error = None
    if body.pdf:
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
        },
    )
    db.commit()
    db.refresh(doc)
    out = DocumentOut.model_validate(doc)
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
    doc = db.get(GeneratedDocument, document_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono dokumentu.")
    e = get_visible(db, ctx.user, doc.employee_id)
    t = db.get(DocumentTemplate, doc.template_id) if doc.template_id else None
    if t is not None:
        _check_doc_access(ctx.user, t)
    if format == "pdf" and not doc.has_pdf:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ten dokument nie ma wersji PDF.")
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
