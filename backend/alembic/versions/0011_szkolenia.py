"""Szkolenia i uprawnienia: słownik rodzajów (z typowymi wpisami) i szkolenia pracowników.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TS = [
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
]

SEED = [
    ("Szkolenie BHP wstępne", "general", None),
    ("Szkolenie BHP okresowe", "general", 36),
    ("Badania lekarskie okresowe", "general", None),
    ("Uprawnienia UDT – wózki widłowe", "general", 60),
    ("Uprawnienia SEP (elektryczne)", "general", 60),
    ("Szkolenie stanowiskowe", "position", None),
]


def upgrade() -> None:
    t = op.create_table(
        "training_types",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("kind", sa.String(10), nullable=False, server_default="general"),
        sa.Column("validity_months", sa.Integer),
        sa.Column("fields", JSONB, nullable=False, server_default="[]"),
        sa.Column("template_id", sa.Integer, sa.ForeignKey("templates.id", ondelete="SET NULL")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        *[c.copy() for c in _TS],
    )
    op.bulk_insert(t, [{"name": n, "kind": k, "validity_months": v, "fields": []} for n, k, v in SEED])
    op.create_table(
        "trainings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "employee_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("type_id", sa.Integer, sa.ForeignKey("training_types.id"), nullable=False),
        sa.Column("name", sa.String(200)),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id", ondelete="SET NULL")),
        sa.Column("start_date", sa.Date),
        sa.Column("exam_date", sa.Date),
        sa.Column("end_date", sa.Date),
        sa.Column("completed_on", sa.Date),
        sa.Column("valid_until", sa.Date),
        sa.Column("mentor_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="SET NULL")),
        sa.Column("standard_days", sa.Integer),
        sa.Column("values", JSONB, nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text),
        sa.Column("scan_file", sa.String(200)),
        sa.Column("scan_name", sa.String(255)),
        sa.Column("scan_type", sa.String(50)),
        sa.Column("created_by_name", sa.String(200)),
        *[c.copy() for c in _TS],
    )
    op.create_index("ix_trainings_employee_id", "trainings", ["employee_id"])
    op.create_index("ix_trainings_type_id", "trainings", ["type_id"])
    op.create_index("ix_trainings_valid_until", "trainings", ["valid_until"])


def downgrade() -> None:
    op.drop_table("trainings")
    op.drop_table("training_types")
