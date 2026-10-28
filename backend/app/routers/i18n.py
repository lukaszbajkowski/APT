"""Język aplikacji pracownika: zapis wyboru na koncie oraz tłumaczenie stałych tekstów ekranów."""

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app import i18n, translate
from app.audit import audit
from app.deps import Auth, DbSession
from app.hardening import limiter
from app.models import Role

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
def languages(request: Request) -> LanguagesOut:
    """Lista języków do wyboru (też dla stron bez logowania). Bez klucza tłumacza: wyłączone."""
    if not translate.enabled():
        return LanguagesOut(enabled=False)
    ip = request.client.host if request.client else "?"
    if not limiter.allow((ip, "i18n-langs"), 120, 3600.0):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Zbyt wiele żądań. Spróbuj za godzinę.")
    try:
        return LanguagesOut(enabled=True, languages=translate.languages())
    except translate.TranslateError:
        return LanguagesOut(enabled=True, languages=[])


class LanguageIn(BaseModel):
    language: str | None = Field(default=None, max_length=12)


@router.put("/language", status_code=status.HTTP_204_NO_CONTENT)
def set_language(body: LanguageIn, ctx: Auth, request: Request, db: DbSession) -> None:
    """Pracownik wybiera język aplikacji i powiadomień (puste = polski)."""
    if ctx.user.role != Role.employee:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    lang = body.language
    if lang and not i18n.valid_lang(lang):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy język.")
    if lang and translate.enabled():
        try:
            i18n.translate_many(db, ["Test"], lang)  # wczesny błąd, gdy język nie jest obsługiwany
        except translate.TranslateError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    ctx.user.language = lang or None
    audit(db, request, "language_changed", user=ctx.user, details={"language": lang})
    db.commit()
