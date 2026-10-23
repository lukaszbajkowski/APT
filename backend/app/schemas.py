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
    role: Role
    is_active: bool
    must_change_password: bool
    locked_until: datetime | None
    last_login_at: datetime | None
    created_at: datetime
    scopes: list[ScopeOut]


class MeOut(BaseModel):
    user: UserOut
    csrf_token: str
    session_idle_minutes: int


class ScopesIn(BaseModel):
    agency_ids: list[int] = Field(default_factory=list)
    department_ids: list[int] = Field(default_factory=list)


def _norm_username(v: str) -> str:
    return v.strip().lower()


class UserCreateIn(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    full_name: str = Field(min_length=2, max_length=200)
    role: Role
    scopes: ScopesIn = Field(default_factory=ScopesIn)

    @field_validator("username", mode="before")
    @classmethod
    def _norm(cls, v: Any) -> Any:
        return _norm_username(v) if isinstance(v, str) else v

    @field_validator("full_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    role: Role | None = None
    is_active: bool | None = None
    scopes: ScopesIn | None = None


class UserCreatedOut(BaseModel):
    user: UserOut
    temporary_password: str


class PasswordResetOut(BaseModel):
    temporary_password: str


class DictionaryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str | None
    name: str
    is_active: bool


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
