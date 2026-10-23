import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Role(str, enum.Enum):
    """Role użytkowników aplikacji."""

    admin = "admin"  # Administrator: wszystko, w tym użytkownicy i szablony
    hr = "hr"  # Kadry: pełna kartoteka, dokumenty, karty
    manager = "manager"  # Kierownik: tylko przypisane APT / wydziały
    viewer = "viewer"  # Podgląd: tylko odczyt, bez pełnego PESEL


ROLE_LABELS = {
    Role.admin: "Administrator",
    Role.hr: "Kadry",
    Role.manager: "Kierownik",
    Role.viewer: "Podgląd",
}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Agency(TimestampMixin, Base):
    """Agencja pracy tymczasowej (APT)."""

    __tablename__ = "agencies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Department(TimestampMixin, Base):
    """Wydział."""

    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="user_role", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    scopes: Mapped[list["UserScope"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )


class UserScope(Base):
    """Zakres widoczności kierownika: konkretna APT albo wydział."""

    __tablename__ = "user_scopes"
    __table_args__ = (
        CheckConstraint(
            "(agency_id IS NOT NULL) <> (department_id IS NOT NULL)",
            name="ck_user_scopes_one_target",
        ),
        UniqueConstraint("user_id", "agency_id", name="uq_user_scopes_agency"),
        UniqueConstraint("user_id", "department_id", name="uq_user_scopes_department"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"))

    user: Mapped[User] = relationship(back_populates="scopes")


class UserSession(Base):
    """Sesja logowania. W bazie trzymamy tylko skrót tokenu, nigdy sam token."""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(400))

    user: Mapped[User] = relationship(lazy="joined")


class AuditLog(Base):
    """Dziennik zdarzeń. Tylko dopisywanie."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class Position(TimestampMixin, Base):
    """Stanowisko (opcjonalnie przypięte do wydziału)."""

    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint(
            "name", "department_id", name="uq_positions_name_department", postgresql_nulls_not_distinct=True
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Country(Base):
    """Słownik krajów (obywatelstwo / narodowość)."""

    __tablename__ = "countries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    iso_code: Mapped[str | None] = mapped_column(String(2), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Sex(str, enum.Enum):
    female = "K"
    male = "M"


class EmployeeStatus(str, enum.Enum):
    active = "active"
    terminated = "terminated"


employee_number_seq = Sequence("employee_number_seq", start=1)


class Employee(TimestampMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (
        Index("ix_employees_name", "last_name", "first_name"),
        Index(
            "uq_employees_pesel_hash",
            "pesel_hash",
            unique=True,
            postgresql_where="pesel_hash IS NOT NULL",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Numer ewidencyjny: nadawany z sekwencji, unikalny i niezmienny.
    number: Mapped[int] = mapped_column(
        Integer, employee_number_seq, server_default=employee_number_seq.next_value(), unique=True
    )
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    sex: Mapped[Sex | None] = mapped_column(
        Enum(Sex, name="employee_sex", values_callable=lambda e: [m.value for m in e])
    )
    birth_date: Mapped[date | None] = mapped_column(Date)
    pesel_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    pesel_hash: Mapped[str | None] = mapped_column(String(64))
    pesel_last2: Mapped[str | None] = mapped_column(String(2))
    country_id: Mapped[int | None] = mapped_column(ForeignKey("countries.id"))
    agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.id"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True)
    position_id: Mapped[int | None] = mapped_column(ForeignKey("positions.id"))
    hire_date: Mapped[date | None] = mapped_column(Date)
    termination_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[EmployeeStatus] = mapped_column(
        Enum(EmployeeStatus, name="employee_status", values_callable=lambda e: [m.value for m in e]),
        default=EmployeeStatus.active,
        nullable=False,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    country: Mapped[Country | None] = relationship(lazy="joined")
    agency: Mapped[Agency | None] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(lazy="joined")
    position: Mapped[Position | None] = relationship(lazy="joined")
    photo: Mapped["Photo | None"] = relationship(
        back_populates="employee", lazy="joined", uselist=False, cascade="all, delete-orphan"
    )


class Photo(Base):
    """Zdjęcie pracownika. Plik leży na dysku serwera, w bazie tylko opis."""

    __tablename__ = "photos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    employee: Mapped[Employee] = relationship(back_populates="photo")
