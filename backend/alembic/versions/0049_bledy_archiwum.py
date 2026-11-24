"""Błędy aplikacji: archiwum rozwiązanych (kiedy, kto, czy wrócił po rozwiązaniu).

Revision ID: 0049
Revises: 0048
"""

import sqlalchemy as sa
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_errors", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("app_errors", sa.Column("resolved_by", sa.String(120), nullable=True))
    op.add_column("app_errors", sa.Column("reopened", sa.Boolean, nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("app_errors", "reopened")
    op.drop_column("app_errors", "resolved_by")
    op.drop_column("app_errors", "resolved_at")
