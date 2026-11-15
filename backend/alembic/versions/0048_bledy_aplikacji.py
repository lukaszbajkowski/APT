"""Błędy aplikacji (API i przeglądarka) – zgrupowane, bez danych osobowych.

Revision ID: 0048
Revises: 0047
"""

import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_errors",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("fingerprint", sa.String(32), nullable=False, unique=True),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("kind", sa.String(120), nullable=False),
        sa.Column("message", sa.String(500), nullable=False, server_default=""),
        sa.Column("path", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.Integer, nullable=True),
        sa.Column("role", sa.String(20), nullable=True),
        sa.Column("count", sa.Integer, nullable=False, server_default="1"),
        sa.Column("first_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_app_errors_last_at", "app_errors", ["last_at"])


def downgrade() -> None:
    op.drop_index("ix_app_errors_last_at", table_name="app_errors")
    op.drop_table("app_errors")
