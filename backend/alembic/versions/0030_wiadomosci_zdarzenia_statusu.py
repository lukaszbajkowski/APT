"""Wiadomości do kadr: zdarzenia zmiany statusu w rozmowie.

Revision ID: 0030
Revises: 0029
"""

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hr_messages", sa.Column("kind", sa.String(10), nullable=False, server_default="message"))


def downgrade() -> None:
    op.drop_column("hr_messages", "kind")
