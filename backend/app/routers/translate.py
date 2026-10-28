"""Tłumaczenie wiadomości „Napisz do kadr” (Google Cloud Translation), na żądanie uczestnika rozmowy."""

import re

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app import translate
from app.audit import audit
from app.deps import Auth, DbSession
from app.hardening import limiter
from app.models import HrMessage, HrThread, Role
from app.translate import exhausted

router = APIRouter(prefix="/api/translate", tags=["translate"])

LANG = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")
PER_HOUR = 120


class ConfigOut(BaseModel):
    enabled: bool
    exhausted: bool = False
    languages: list[dict[str, str]] = []


@router.get("/config", response_model=ConfigOut)
def config(ctx: Auth, db: DbSession) -> ConfigOut:
    if not translate.enabled():
        return ConfigOut(enabled=False)
    done = exhausted(db)
    try:
        return ConfigOut(enabled=True, exhausted=done, languages=translate.languages())
    except translate.TranslateError:
        return ConfigOut(enabled=True, exhausted=done, languages=[])


class MessageIn(BaseModel):
    message_id: int
    target: str = Field(min_length=2, max_length=12)


class TranslationOut(BaseModel):
    text: str
    source: str | None
    target: str


@router.post("/message", response_model=TranslationOut)
def translate_message(body: MessageIn, ctx: Auth, request: Request, db: DbSession) -> TranslationOut:
    """Tłumaczy jedną wiadomość z rozmowy, w której użytkownik uczestniczy (nie dowolny tekst)."""
    if not translate.enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tłumaczenie nie jest włączone.")
    if not LANG.match(body.target):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy język.")
    m = db.get(HrMessage, body.message_id)
    t = db.get(HrThread, m.thread_id) if m else None
    if m is None or t is None or m.kind != "message":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono wiadomości.")
    if ctx.user.role == Role.employee:
        if ctx.user.employee_id != t.employee_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono wiadomości.")
    elif ctx.user.role not in (Role.admin, Role.hr):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    if not limiter.allow((str(ctx.user.id), "translate"), PER_HOUR, 3600.0):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="Zbyt wiele tłumaczeń. Spróbuj za godzinę."
        )
    if exhausted(db, len(m.body)):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Miesięczny limit tłumaczeń został wykorzystany. Wróci od początku następnego miesiąca.",
        )
    try:
        text, source = translate.translate(m.body, body.target)
    except translate.TranslateError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    audit(
        db,
        request,
        "message_translated",
        user=ctx.user,
        entity_type="employee",
        entity_id=t.employee_id,
        details={"thread": t.id, "target": body.target, "chars": len(m.body)},
    )
    db.commit()
    return TranslationOut(text=text, source=source, target=body.target)
