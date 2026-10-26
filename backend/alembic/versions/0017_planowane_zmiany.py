"""Zaplanowane zmiany przydziału (APT, wydział, stanowisko).

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "planned_changes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "employee_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("effective_date", sa.Date, nullable=False),
        sa.Column("changes", JSONB, nullable=False),
        sa.Column("created_by_name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_planned_changes_employee_id", "planned_changes", ["employee_id"])
    op.create_index("ix_planned_changes_effective_date", "planned_changes", ["effective_date"])


def downgrade() -> None:
    op.drop_table("planned_changes")
