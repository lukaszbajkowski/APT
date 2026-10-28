"""Język pracownika: wybór języka na koncie i pamięć podręczna tłumaczeń stałych tekstów.

Revision ID: 0038
Revises: 0037
"""

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("language", sa.String(12), nullable=True))
    op.create_table(
        "ui_translations",
        sa.Column("lang", sa.String(12), nullable=False),
        sa.Column("source_hash", sa.String(40), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("lang", "source_hash"),
    )


def downgrade() -> None:
    op.drop_table("ui_translations")
    op.drop_column("users", "language")
