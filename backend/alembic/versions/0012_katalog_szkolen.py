"""Katalog szkoleń stanowiskowych (nazwa, wydział, standard czasu nauki).

Pola formularza szkolenia pochodzą odtąd z szablonu dokumentu podpiętego do rodzaju.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "training_programs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "type_id", sa.Integer, sa.ForeignKey("training_types.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id", ondelete="SET NULL")),
        sa.Column("standard_days", sa.Integer),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "type_id",
            "name",
            "department_id",
            name="uq_training_programs",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index("ix_training_programs_type_id", "training_programs", ["type_id"])
    op.add_column(
        "trainings",
        sa.Column("program_id", sa.Integer, sa.ForeignKey("training_programs.id", ondelete="SET NULL")),
    )


def downgrade() -> None:
    op.drop_column("trainings", "program_id")
    op.drop_table("training_programs")
