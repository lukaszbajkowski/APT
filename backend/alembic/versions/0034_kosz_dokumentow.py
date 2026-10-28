"""Kosz dokumentów: usunięcie jest miękkie, dokument wraca z kosza przez 30 dni.

Revision ID: 0034
Revises: 0033
"""

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("documents", sa.Column("deleted_by_name", sa.String(200)))
    op.add_column("documents", sa.Column("delete_reason", sa.String(500)))
    op.create_index("ix_documents_deleted_at", "documents", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_documents_deleted_at", table_name="documents")
    op.drop_column("documents", "delete_reason")
    op.drop_column("documents", "deleted_by_name")
    op.drop_column("documents", "deleted_at")
