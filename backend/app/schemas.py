from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import Role

USERNAME_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,63}$"


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class ScopeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    agency_id: int | None
    department_id: int | None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    email: str | None = None
    role: Role
    is_active: bool
    must_change_password: bool
    locked_until: datetime | None
    last_login_at: datetime | None
    created_at: datetime
    scopes: list[ScopeOut]
    agency_id: int | None = None  # konto agencji pracy
    mfa_enabled: bool
    mfa_required: bool


class MeOut(BaseModel):
    user: UserOut
    csrf_token: str
    session_idle_minutes: int
    mfa_pending: bool = False
    mfa_setup_required: bool = False
    recovery_codes_left: int = 0
    # symulacja uprawnień przez administratora
    real_role: str | None = None
    sim_role: str | None = None
    sim_agency_id: int | None = None
    sim_department_id: int | None = None


class ScopesIn(BaseModel):
    agency_ids: list[int] = Field(default_factory=list)
    department_ids: list[int] = Field(default_factory=list)


def _norm_username(v: str) -> str:
    return v.strip().lower()


EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def _norm_email(v: Any) -> Any:
    if isinstance(v, str):
        v = v.strip().lower()
        return v or None
    return v


class UserCreateIn(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    full_name: str = Field(min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=254, pattern=EMAIL_PATTERN)
    send_invite: bool = True
    role: Role
    scopes: ScopesIn = Field(default_factory=ScopesIn)
    agency_id: int | None = None  # wymagane dla roli „agency”

    @field_validator("username", mode="before")
    @classmethod
    def _norm(cls, v: Any) -> Any:
        return _norm_username(v) if isinstance(v, str) else v

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v: Any) -> Any:
        return _norm_email(v)

    @field_validator("full_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=254, pattern=r"^$|" + EMAIL_PATTERN)
    role: Role | None = None
    is_active: bool | None = None
    scopes: ScopesIn | None = None
    agency_id: int | None = None

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v: Any) -> Any:
        # "" = usuń adres; None (brak pola) = bez zmian – rozróżniamy przez model_fields_set
        return _norm_email(v) if v != "" else ""


class UserCreatedOut(BaseModel):
    user: UserOut
    temporary_password: str
    invite_sent: bool = False


class PasswordResetOut(BaseModel):
    temporary_password: str


class DictionaryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str | None
    name: str
    is_active: bool
    email: str | None = None  # tylko APT


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    user_id: int | None
    username: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    ip: str | None
    details: dict[str, Any] | None

    @field_validator("ip", mode="before")
    @classmethod
    def _ip_str(cls, v: Any) -> str | None:
        return str(v) if v is not None else None


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
