"""Szkolenia wymagane na stanowisku.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "position_requirements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "position_id", sa.Integer, sa.ForeignKey("positions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "type_id", sa.Integer, sa.ForeignKey("training_types.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("program_id", sa.Integer, sa.ForeignKey("training_programs.id", ondelete="CASCADE")),
        sa.UniqueConstraint(
            "position_id",
            "type_id",
            "program_id",
            name="uq_position_requirements",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index("ix_position_requirements_position_id", "position_requirements", ["position_id"])


def downgrade() -> None:
    op.drop_table("position_requirements")
