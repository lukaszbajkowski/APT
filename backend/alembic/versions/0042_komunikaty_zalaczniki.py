"""Komunikaty: załączniki i automatyczne archiwum.

Revision ID: 0042
Revises: 0041
"""

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcasts", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_broadcasts_archived_at", "broadcasts", ["archived_at"])
    op.create_table(
        "broadcast_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "broadcast_id", sa.Integer(), sa.ForeignKey("broadcasts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("file_name", sa.String(100), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
    )
    op.create_index("ix_broadcast_files_broadcast_id", "broadcast_files", ["broadcast_id"])


def downgrade() -> None:
    op.drop_table("broadcast_files")
    op.drop_index("ix_broadcasts_archived_at", table_name="broadcasts")
    op.drop_column("broadcasts", "archived_at")
