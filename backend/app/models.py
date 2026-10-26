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
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
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

    # Logowanie dwuetapowe (TOTP). Sekret zaszyfrowany kluczem APT_DATA_KEY.
    # Gdy totp_enabled_at jest puste, a sekret jest ustawiony – konfiguracja w toku.
    totp_secret_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_step: Mapped[int | None] = mapped_column(BigInteger)
    # skróty SHA-256 niewykorzystanych kodów zapasowych
    recovery_codes: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    @property
    def mfa_enabled(self) -> bool:
        return self.totp_enabled_at is not None

    @property
    def mfa_required(self) -> bool:
        from app.config import get_settings

        return self.role in MFA_REQUIRED_ROLES and get_settings().mfa_enforce

    @property
    def recovery_codes_left(self) -> int:
        return len(self.recovery_codes or [])

    scopes: Mapped[list["UserScope"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )


MFA_REQUIRED_ROLES = frozenset({Role.admin, Role.hr})


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
    # hasło poprawne, czeka na kod z aplikacji (logowanie dwuetapowe)
    mfa_pending: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    # symulacja uprawnień (tylko administrator): rola i zakres kierownika
    sim_role: Mapped[str | None] = mapped_column(String(20))
    sim_agency_id: Mapped[int | None] = mapped_column(Integer)
    sim_department_id: Mapped[int | None] = mapped_column(Integer)

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
    # Wstrzymanie usunięcia po okresie retencji (np. toczące się postępowanie)
    retention_hold_until: Mapped[date | None] = mapped_column(Date)
    retention_hold_reason: Mapped[str | None] = mapped_column(String(500))

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


class DocumentTemplate(TimestampMixin, Base):
    """Szablon dokumentu .docx. Plik na dysku: templates/<id>_v<wersja>.docx."""

    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(5), default="pl", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    variables: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Czy Kierownik może używać szablonu (PESEL i data urodzenia zostaną wtedy puste).
    allow_manager: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Formaty do pobrania: "pdf", "docx" albo "both". Podgląd online jest zawsze w PDF.
    download_formats: Mapped[str] = mapped_column(String(8), default="both", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class GeneratedDocument(Base):
    """Wygenerowany dokument pracownika. Pliki na dysku: documents/<employee_id>/<id>.(docx|pdf)."""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    template_name: Mapped[str] = mapped_column(String(200), nullable=False)
    template_version: Mapped[int] = mapped_column(Integer, nullable=False)
    has_pdf: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Dokument zawiera PESEL lub datę urodzenia – niedostępny dla Kierownika.
    contains_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # podpis: role z miejscem na podpis w PDF (np. ["pracownika", "firmy"]) i stan
    signature_roles: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # wszyscy podpisali
    has_signed_pdf: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class DocumentSignature(Base):
    """Prośba o podpis i sam podpis. Pliki: documents/<employee_id>/<document_id>_sig_<id>.(png|pdf|xml)."""

    __tablename__ = "document_signatures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(10), default="pending", nullable=False
    )  # pending|signed|cancelled
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    channel: Mapped[str] = mapped_column(String(10), default="link", nullable=False)  # email|sms|link|skan
    sent_to: Mapped[str | None] = mapped_column(String(254))
    signer_name: Mapped[str | None] = mapped_column(String(200))
    method: Mapped[str | None] = mapped_column(String(10))  # ekran|zaufany|skan
    file_name: Mapped[str | None] = mapped_column(String(200))
    original_name: Mapped[str | None] = mapped_column(String(255))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(400))
    requested_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasswordToken(Base):
    """Jednorazowy link e-mail: reset hasła albo ustawienie hasła nowego konta. W bazie tylko skrót."""

    __tablename__ = "password_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    purpose: Mapped[str] = mapped_column(String(10), nullable=False)  # reset | invite
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(lazy="joined")


class TrainingType(TimestampMixin, Base):
    """Rodzaj szkolenia / uprawnienia (słownik). Własne pola jak w szablonach dokumentów."""

    __tablename__ = "training_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    # "general" – zwykłe szkolenie/uprawnienie, "position" – szkolenie stanowiskowe (daty, opiekun, standard)
    kind: Mapped[str] = mapped_column(String(10), default="general", nullable=False)
    # domyślny okres ważności w miesiącach (podpowiada „ważne do”); None = bezterminowe / wpisywane ręcznie
    validity_months: Mapped[int | None] = mapped_column(Integer)
    fields: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class TrainingProgram(TimestampMixin, Base):
    """Pozycja katalogu szkoleń stanowiskowych: nazwa, wydział i standard czasu nauki."""

    __tablename__ = "training_programs"
    __table_args__ = (
        UniqueConstraint(
            "type_id",
            "name",
            "department_id",
            name="uq_training_programs",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type_id: Mapped[int] = mapped_column(
        ForeignKey("training_types.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    standard_days: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    department: Mapped[Department | None] = relationship(lazy="joined")
    mentors: Mapped[list["Employee"]] = relationship(
        secondary="training_program_mentors", lazy="selectin", order_by="Employee.last_name"
    )


class TrainingProgramMentor(Base):
    """Kto może prowadzić (być opiekunem) danego szkolenia stanowiskowego z katalogu."""

    __tablename__ = "training_program_mentors"

    program_id: Mapped[int] = mapped_column(
        ForeignKey("training_programs.id", ondelete="CASCADE"), primary_key=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Training(TimestampMixin, Base):
    """Szkolenie / uprawnienie pracownika. Skan zaświadczenia: trainings/<employee_id>/<id>.<ext>."""

    __tablename__ = "trainings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type_id: Mapped[int] = mapped_column(ForeignKey("training_types.id"), index=True, nullable=False)
    program_id: Mapped[int | None] = mapped_column(ForeignKey("training_programs.id", ondelete="SET NULL"))
    name: Mapped[str | None] = mapped_column(String(200))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    start_date: Mapped[date | None] = mapped_column(Date)
    exam_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    completed_on: Mapped[date | None] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date, index=True)
    mentor_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    standard_days: Mapped[int | None] = mapped_column(Integer)
    values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    scan_file: Mapped[str | None] = mapped_column(String(200))
    scan_name: Mapped[str | None] = mapped_column(String(255))
    scan_type: Mapped[str | None] = mapped_column(String(50))
    created_by_name: Mapped[str | None] = mapped_column(String(200))

    type: Mapped[TrainingType] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(lazy="joined")
    mentor: Mapped[Employee | None] = relationship(foreign_keys=[mentor_id], lazy="joined")


class PositionRequirement(Base):
    """Szkolenie wymagane na stanowisku: rodzaj, opcjonalnie konkretna pozycja katalogu."""

    __tablename__ = "position_requirements"
    __table_args__ = (
        UniqueConstraint(
            "position_id",
            "type_id",
            "program_id",
            name="uq_position_requirements",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position_id: Mapped[int] = mapped_column(
        ForeignKey("positions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type_id: Mapped[int] = mapped_column(ForeignKey("training_types.id", ondelete="CASCADE"), nullable=False)
    program_id: Mapped[int | None] = mapped_column(ForeignKey("training_programs.id", ondelete="CASCADE"))

    type: Mapped[TrainingType] = relationship(lazy="joined")
    program: Mapped[TrainingProgram | None] = relationship(lazy="joined")


class EmploymentPeriod(Base):
    """Zakończony wcześniejszy okres zatrudnienia (przy ponownym zatrudnieniu)."""

    __tablename__ = "employment_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    hire_date: Mapped[date | None] = mapped_column(Date)
    termination_date: Mapped[date | None] = mapped_column(Date)
    agency_name: Mapped[str | None] = mapped_column(String(200))
    department_name: Mapped[str | None] = mapped_column(String(200))
    position_name: Mapped[str | None] = mapped_column(String(200))


class Assignment(Base):
    """Historia przydziału: APT, wydział, stanowisko od danej daty (nazwy zapisane na tamtą chwilę)."""

    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    agency_name: Mapped[str | None] = mapped_column(String(200))
    department_name: Mapped[str | None] = mapped_column(String(200))
    position_name: Mapped[str | None] = mapped_column(String(200))
    reason: Mapped[str | None] = mapped_column(String(50))  # zatrudnienie | zmiana | ponowne
    changed_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ChecklistTemplateItem(TimestampMixin, Base):
    """Pozycja szablonu checklisty: wdrożenie (od daty zatrudnienia) albo odejście (od daty zwolnienia)."""

    __tablename__ = "checklist_template_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)  # onboarding | offboarding
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    responsible: Mapped[str] = mapped_column(String(10), default="hr", nullable=False)  # hr | manager
    due_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # automatyczne odhaczenie: photo | card | training:<type_id> | document:<template_id>
    auto: Mapped[str | None] = mapped_column(String(40))
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # zakres: puste = wszyscy; inaczej tylko osoby z tych APT / wydziałów
    agency_ids: Mapped[list[int]] = mapped_column(JSONB, default=list, nullable=False)
    department_ids: Mapped[list[int]] = mapped_column(JSONB, default=list, nullable=False)


class ChecklistItem(Base):
    """Pozycja checklisty konkretnego pracownika (kopia szablonu z chwili utworzenia)."""

    __tablename__ = "checklist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    template_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("checklist_template_items.id", ondelete="SET NULL")
    )
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    responsible: Mapped[str] = mapped_column(String(10), default="hr", nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    auto: Mapped[str | None] = mapped_column(String(40))
    sort: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_by_name: Mapped[str | None] = mapped_column(String(200))
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PlannedChange(Base):
    """Zaplanowana zmiana APT / wydziału / stanowiska – wprowadzana automatycznie w dniu effective_date."""

    __tablename__ = "planned_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), index=True, nullable=False
    )
    effective_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)  # {"department_id": 3, ...}
    created_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
