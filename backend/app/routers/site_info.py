"""Pomoc i prywatność: kontakt w sprawie aplikacji (kadry / administrator) i informacja o przetwarzaniu danych.

Odczyt jest publiczny – link „Pomoc i prywatność” jest na ekranie logowania, a pracownik musi znać zasady
przetwarzania danych, zanim się zaloguje. Treść zmienia tylko administrator (zmiana trafia do dziennika).
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.audit import audit
from app.deps import AdminAuth, DbSession
from app.models import SiteInfo

router = APIRouter(prefix="/api/site-info", tags=["site-info"])


class SiteInfoIn(BaseModel):
    contact_name: str = Field(default="", max_length=120)
    contact_email: str = Field(default="", max_length=200, pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$")
    contact_phone: str = Field(default="", max_length=40, pattern=r"^[0-9 +()\-]*$")
    contact_hours: str = Field(default="", max_length=120)
    privacy_text: str = Field(default="", max_length=20000)


class SiteInfoOut(BaseModel):
    contact_name: str
    contact_email: str
    contact_phone: str
    contact_hours: str
    privacy_text: str
    updated_at: str | None


def _row(db) -> SiteInfo | None:  # noqa: ANN001
    return db.get(SiteInfo, 1)


def _out(s: SiteInfo | None) -> SiteInfoOut:
    if s is None:
        return SiteInfoOut(contact_name="", contact_email="", contact_phone="", contact_hours="", privacy_text="", updated_at=None)
    return SiteInfoOut(
        contact_name=s.contact_name, contact_email=s.contact_email, contact_phone=s.contact_phone,
        contact_hours=s.contact_hours, privacy_text=s.privacy_text, updated_at=s.updated_at.isoformat(),
    )


@router.get("", response_model=SiteInfoOut)
def get_info(db: DbSession) -> SiteInfoOut:
    return _out(_row(db))


@router.put("", response_model=SiteInfoOut)
def put_info(body: SiteInfoIn, ctx: AdminAuth, request: Request, db: DbSession) -> SiteInfoOut:
    s = _row(db)
    if s is None:
        s = SiteInfo(id=1)
        db.add(s)
    changed = []
    for f in ("contact_name", "contact_email", "contact_phone", "contact_hours", "privacy_text"):
        v = getattr(body, f).strip()
        if getattr(s, f, None) != v:
            changed.append(f)
        setattr(s, f, v)
    s.updated_by_name = ctx.user.full_name
    audit(db, request, "site_info_updated", user=ctx.user, entity_type="site_info", entity_id=1, details={"fields": changed})
    db.commit()
    db.refresh(s)
    return _out(s)
