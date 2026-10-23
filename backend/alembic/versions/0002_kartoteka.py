"""Kartoteka: pracownicy, stanowiska, kraje, zdjęcia.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COUNTRIES = [
    ("Polska", "PL"),
    ("Ukraina", "UA"),
    ("Białoruś", "BY"),
    ("Mołdawia", "MD"),
    ("Gruzja", "GE"),
    ("Armenia", "AM"),
    ("Azerbejdżan", "AZ"),
    ("Kazachstan", "KZ"),
    ("Kirgistan", "KG"),
    ("Uzbekistan", "UZ"),
    ("Tadżykistan", "TJ"),
    ("Turkmenistan", "TM"),
    ("Rosja", "RU"),
    ("Litwa", "LT"),
    ("Łotwa", "LV"),
    ("Estonia", "EE"),
    ("Niemcy", "DE"),
    ("Czechy", "CZ"),
    ("Słowacja", "SK"),
    ("Rumunia", "RO"),
    ("Bułgaria", "BG"),
    ("Węgry", "HU"),
    ("Turcja", "TR"),
    ("Indie", "IN"),
    ("Nepal", "NP"),
    ("Bangladesz", "BD"),
    ("Pakistan", "PK"),
    ("Sri Lanka", "LK"),
    ("Filipiny", "PH"),
    ("Indonezja", "ID"),
    ("Wietnam", "VN"),
    ("Kolumbia", "CO"),
    ("Wenezuela", "VE"),
    ("Meksyk", "MX"),
    ("Nigeria", "NG"),
    ("Zimbabwe", "ZW"),
    ("Etiopia", "ET"),
    ("Egipt", "EG"),
    ("Maroko", "MA"),
]


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    # Skrót APT / wydziału staje się opcjonalny, nazwa musi być unikalna.
    for table in ("agencies", "departments"):
        op.alter_column(table, "code", existing_type=sa.String(32), nullable=True)
        op.create_unique_constraint(f"uq_{table}_name", table, ["name"])

    op.create_table(
        "positions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id", ondelete="SET NULL")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.UniqueConstraint(
            "name", "department_id", name="uq_positions_name_department", postgresql_nulls_not_distinct=True
        ),
    )

    countries = op.create_table(
        "countries",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("iso_code", sa.String(2), unique=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.bulk_insert(countries, [{"name": n, "iso_code": c, "is_active": True} for n, c in COUNTRIES])

    op.execute("CREATE SEQUENCE employee_number_seq START 1")
    sex = postgresql.ENUM("K", "M", name="employee_sex")
    status = postgresql.ENUM("active", "terminated", name="employee_status")
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "number",
            sa.Integer,
            nullable=False,
            unique=True,
            server_default=sa.text("nextval('employee_number_seq')"),
        ),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("sex", sex),
        sa.Column("birth_date", sa.Date),
        sa.Column("pesel_enc", sa.LargeBinary),
        sa.Column("pesel_hash", sa.String(64)),
        sa.Column("pesel_last2", sa.String(2)),
        sa.Column("country_id", sa.Integer, sa.ForeignKey("countries.id")),
        sa.Column("agency_id", sa.Integer, sa.ForeignKey("agencies.id")),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id")),
        sa.Column("position_id", sa.Integer, sa.ForeignKey("positions.id")),
        sa.Column("hire_date", sa.Date),
        sa.Column("termination_date", sa.Date),
        sa.Column("status", status, nullable=False, server_default="active"),
        sa.Column("notes", sa.Text),
        *_timestamps(),
        sa.CheckConstraint("(pesel_enc IS NULL) = (pesel_hash IS NULL)", name="ck_employees_pesel_pair"),
    )
    op.execute("ALTER SEQUENCE employee_number_seq OWNED BY employees.number")
    op.create_index("ix_employees_name", "employees", ["last_name", "first_name"])
    op.create_index("ix_employees_agency_id", "employees", ["agency_id"])
    op.create_index("ix_employees_department_id", "employees", ["department_id"])
    op.create_index("ix_employees_status", "employees", ["status"])
    op.create_index(
        "uq_employees_pesel_hash",
        "employees",
        ["pesel_hash"],
        unique=True,
        postgresql_where=sa.text("pesel_hash IS NOT NULL"),
    )

    op.create_table(
        "photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "employee_id",
            sa.Integer,
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("file_name", sa.String(200), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("photos")
    op.drop_table("employees")  # sekwencja usuwana razem z kolumną (OWNED BY)
    op.execute("DROP TYPE IF EXISTS employee_status")
    op.execute("DROP TYPE IF EXISTS employee_sex")
    op.drop_table("countries")
    op.drop_table("positions")
    for table in ("agencies", "departments"):
        op.drop_constraint(f"uq_{table}_name", table, type_="unique")
        op.execute(f"UPDATE {table} SET code = 'ID' || id WHERE code IS NULL")
        op.alter_column(table, "code", existing_type=sa.String(32), nullable=False)
