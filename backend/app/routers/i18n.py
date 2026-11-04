"""Język aplikacji pracownika: zapis wyboru na koncie oraz tłumaczenie stałych tekstów ekranów."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import i18n, i18n_glossary, translate
from app.audit import audit
from app.deps import AdminAuth, Auth, DbSession, utcnow
from app.hardening import limiter
from app.models import Role, UiTranslation

router = APIRouter(prefix="/api/i18n", tags=["i18n"])

PER_HOUR = 60
PUBLIC_PER_HOUR = 30


class StringsIn(BaseModel):
    lang: str = Field(min_length=2, max_length=12)
    strings: list[str] = Field(max_length=i18n.MAX_STRINGS)


class StringsOut(BaseModel):
    translations: dict[str, str]


def _run(db: DbSession, request: Request, body: StringsIn, user=None) -> StringsOut:
    if not i18n.valid_lang(body.lang):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy język.")
    if any(len(s) > i18n.MAX_LEN for s in body.strings):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Za długi tekst.")
    try:
        done = i18n.translate_many(db, body.strings, body.lang, request, user)
    except translate.TranslateError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return StringsOut(translations=done)


@router.post("/strings", response_model=StringsOut)
def strings(body: StringsIn, ctx: Auth, request: Request, db: DbSession) -> StringsOut:
    """Tłumaczy stałe teksty ekranów (z pamięci lub przez Google; wynik zapisuje dla wszystkich)."""
    if not limiter.allow((str(ctx.user.id), "i18n"), PER_HOUR, 3600.0):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Zbyt wiele żądań. Spróbuj za godzinę.")
    return _run(db, request, body, ctx.user)


@router.post("/public", response_model=StringsOut)
def public_strings(body: StringsIn, request: Request, db: DbSession) -> StringsOut:
    """To samo dla stron bez logowania (podpis z linku, link do uzupełnienia danych) – osobny limit na IP."""
    ip = request.client.host if request.client else "?"
    if not limiter.allow((ip, "i18n-public"), PUBLIC_PER_HOUR, 3600.0):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Zbyt wiele żądań. Spróbuj za godzinę.")
    return _run(db, request, body)


class LanguagesOut(BaseModel):
    enabled: bool
    languages: list[dict[str, str]] = []


@router.get("/languages", response_model=LanguagesOut)
def languages(request: Request, lang: str = "pl") -> LanguagesOut:
    """Lista języków do wyboru (też dla stron bez logowania). Bez klucza tłumacza: wyłączone."""
    if not translate.enabled():
        return LanguagesOut(enabled=False)
    ip = request.client.host if request.client else "?"
    if not limiter.allow((ip, "i18n-langs"), 120, 3600.0):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Zbyt wiele żądań. Spróbuj za godzinę.")
    try:
        shown = lang if i18n.valid_lang(lang) else "pl"
        try:
            return LanguagesOut(enabled=True, languages=translate.languages(shown))
        except translate.TranslateError:
            if shown == "pl":
                raise
            return LanguagesOut(enabled=True, languages=translate.languages())  # język bez nazw – po polsku
    except translate.TranslateError:
        return LanguagesOut(enabled=True, languages=[])


class LanguageIn(BaseModel):
    language: str | None = Field(default=None, max_length=12)


@router.put("/language", status_code=status.HTTP_204_NO_CONTENT)
def set_language(body: LanguageIn, ctx: Auth, request: Request, db: DbSession) -> None:
    """Pracownik wybiera język aplikacji i powiadomień.

    „pl” = świadomie wybrany polski (aplikacja nie przełączy się już sama na język telefonu);
    puste = nic nie wybrano – aplikacja może sama ustawić język systemu.
    """
    if ctx.user.role != Role.employee:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    lang = body.language
    if lang and lang.lower() in ("pl", "pl-pl"):
        lang = "pl"
    elif lang and not i18n.valid_lang(lang):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy język.")
    if lang and lang != "pl" and translate.enabled():
        try:
            i18n.translate_many(db, ["Test"], lang)  # wczesny błąd, gdy język nie jest obsługiwany
        except translate.TranslateError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    ctx.user.language = lang or None
    audit(db, request, "language_changed", user=ctx.user, details={"language": lang})
    db.commit()


# ——— ekran „Tłumaczenia” (administrator): przegląd i ręczne poprawki ———


class AdminLang(BaseModel):
    code: str
    count: int
    manual: int


class AdminRow(BaseModel):
    source: str
    text: str
    origin: str  # manual | glossary | google
    updated_by_name: str | None = None
    updated_at: datetime | None = None


class AdminList(BaseModel):
    items: list[AdminRow]
    total: int
    without_source: int


class FixIn(BaseModel):
    lang: str = Field(min_length=2, max_length=12)
    source: str = Field(min_length=1, max_length=i18n.MAX_LEN)
    text: str = Field(min_length=1, max_length=2000)


class ResetIn(BaseModel):
    lang: str = Field(min_length=2, max_length=12)
    source: str = Field(min_length=1, max_length=i18n.MAX_LEN)


def _admin_lang(code: str) -> str:
    if not i18n.valid_lang(code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy język.")
    return code


@router.get("/admin/languages", response_model=list[AdminLang])
def admin_languages(ctx: AdminAuth, db: DbSession) -> list[AdminLang]:
    """Języki, w których są już tłumaczenia (z liczbą wpisów i ręcznych poprawek), plus języki słownika."""
    rows = db.execute(
        select(UiTranslation.lang, func.count(), func.count().filter(UiTranslation.manual.is_(True))).group_by(
            UiTranslation.lang
        )
    ).all()
    out = {r[0]: AdminLang(code=r[0], count=r[1], manual=r[2]) for r in rows}
    for code in i18n_glossary.LANGS:
        out.setdefault(code, AdminLang(code=code, count=0, manual=0))
    return sorted(out.values(), key=lambda x: (-x.count, x.code))


@router.get("/admin/translations", response_model=AdminList)
def admin_translations(
    ctx: AdminAuth, db: DbSession, lang: str, q: str = "", origin: str = "", offset: int = 0, limit: int = 50
) -> AdminList:
    lang = _admin_lang(lang)
    limit = max(1, min(limit, 200))
    stored = {r.source: r for r in db.scalars(select(UiTranslation).where(UiTranslation.lang == lang)) if r.source}
    without = db.scalar(
        select(func.count()).select_from(UiTranslation).where(UiTranslation.lang == lang, UiTranslation.source.is_(None))
    )
    merged: dict[str, AdminRow] = {}
    for src, text in i18n_glossary.entries(lang).items():
        merged[src] = AdminRow(source=src, text=text, origin="glossary")
    for src, r in stored.items():
        if r.manual:
            merged[src] = AdminRow(source=src, text=r.text, origin="manual", updated_by_name=r.updated_by_name, updated_at=r.updated_at)
        elif src not in merged:
            merged[src] = AdminRow(source=src, text=r.text, origin="google")
    items = list(merged.values())
    if origin in ("manual", "glossary", "google"):
        items = [i for i in items if i.origin == origin]
    if q.strip():
        needle = q.strip().lower()
        items = [i for i in items if needle in i.source.lower() or needle in i.text.lower()]
    # najpierw krótkie etykiety (tam najczęściej brakuje kontekstu), potem alfabetycznie
    items.sort(key=lambda i: (len(i.source) > 40, i.source.lower()))
    return AdminList(items=items[offset : offset + limit], total=len(items), without_source=without or 0)


@router.put("/admin/translations", response_model=AdminRow)
def admin_fix(body: FixIn, ctx: AdminAuth, request: Request, db: DbSession) -> AdminRow:
    """Ręczna poprawka: zapisuje się na stałe, ma pierwszeństwo przed słownikiem i Google."""
    lang = _admin_lang(body.lang)
    text = body.text.strip()
    if sorted(i18n._VAR.findall(text)) != sorted(i18n._VAR.findall(body.source)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tłumaczenie musi zawierać te same pola w nawiasach klamrowych co oryginał, np. {imie}.",
        )
    row = db.get(UiTranslation, (lang, i18n.key(body.source)))
    if row is None:
        row = UiTranslation(lang=lang, source_hash=i18n.key(body.source))
        db.add(row)
    row.source = body.source
    row.text = text
    row.manual = True
    row.updated_by_name = ctx.user.full_name
    row.updated_at = utcnow()
    audit(db, request, "ui_translation_fixed", user=ctx.user, details={"lang": lang, "source": body.source[:120]})
    db.commit()
    return AdminRow(source=row.source, text=row.text, origin="manual", updated_by_name=row.updated_by_name, updated_at=row.updated_at)


@router.post("/admin/translations/reset", status_code=status.HTTP_204_NO_CONTENT)
def admin_reset(body: ResetIn, ctx: AdminAuth, request: Request, db: DbSession) -> None:
    """Cofa poprawkę / zapamiętane tłumaczenie: przy kolejnym użyciu decyduje słownik albo Google."""
    lang = _admin_lang(body.lang)
    row = db.get(UiTranslation, (lang, i18n.key(body.source)))
    if row is not None:
        db.delete(row)
        audit(db, request, "ui_translation_reset", user=ctx.user, details={"lang": lang, "source": body.source[:120]})
        db.commit()
