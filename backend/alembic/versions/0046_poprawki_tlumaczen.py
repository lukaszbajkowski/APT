"""Tłumaczenia aplikacji: polski oryginał i ręczne poprawki administratora.

Revision ID: 0046
Revises: 0045
"""

import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ui_translations", sa.Column("source", sa.Text, nullable=True))
    op.add_column("ui_translations", sa.Column("manual", sa.Boolean, nullable=False, server_default=sa.false()))
    op.add_column("ui_translations", sa.Column("updated_by_name", sa.String(200), nullable=True))
    op.add_column("ui_translations", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for c in ("updated_at", "updated_by_name", "manual", "source"):
        op.drop_column("ui_translations", c)
