"""Opiekunowie szkoleń: kto może prowadzić daną pozycję katalogu szkoleń stanowiskowych.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "training_program_mentors",
        sa.Column(
            "program_id",
            sa.Integer,
            sa.ForeignKey("training_programs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "employee_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True
        ),
    )
    op.create_index("ix_training_program_mentors_employee_id", "training_program_mentors", ["employee_id"])


def downgrade() -> None:
    op.drop_table("training_program_mentors")
