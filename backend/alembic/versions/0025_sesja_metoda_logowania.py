"""Sesje: sposób zalogowania (hasło / klucz dostępu).

Revision ID: 0025
Revises: 0024
"""

import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("auth_method", sa.String(10), nullable=False, server_default="password"),
    )


def downgrade() -> None:
    op.drop_column("user_sessions", "auth_method")
