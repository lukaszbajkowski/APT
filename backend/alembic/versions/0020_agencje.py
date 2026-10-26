"""Agencje pracy: e-mail do zestawień, konto agencji, badania lekarskie, zgłoszenia nowych osób.

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agency'")
    op.add_column("agencies", sa.Column("email", sa.String(500)))
    op.add_column(
        "users", sa.Column("agency_id", sa.Integer(), sa.ForeignKey("agencies.id", ondelete="SET NULL"))
    )
    op.create_table(
        "medical_exams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("exam_date", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date()),
        sa.Column("file_name", sa.String(200)),
        sa.Column("original_name", sa.String(255)),
        sa.Column("notes", sa.String(500)),
        sa.Column("created_by_name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_medical_exams_employee_id", "medical_exams", ["employee_id"])
    op.create_index("ix_medical_exams_valid_until", "medical_exams", ["valid_until"])
    op.create_table(
        "employee_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("agency_id", sa.Integer(), sa.ForeignKey("agencies.id"), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("pesel_enc", sa.LargeBinary()),
        sa.Column("country_id", sa.Integer(), sa.ForeignKey("countries.id")),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id")),
        sa.Column("position_id", sa.Integer(), sa.ForeignKey("positions.id")),
        sa.Column("hire_date", sa.Date()),
        sa.Column("notes", sa.String(1000)),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("created_by_name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_by_name", sa.String(200)),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("reject_reason", sa.String(500)),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="SET NULL")),
    )
    op.create_index("ix_employee_requests_agency_id", "employee_requests", ["agency_id"])
    op.create_index("ix_employee_requests_status", "employee_requests", ["status"])


def downgrade() -> None:
    op.drop_table("employee_requests")
    op.drop_table("medical_exams")
    op.drop_column("users", "agency_id")
    op.drop_column("agencies", "email")
