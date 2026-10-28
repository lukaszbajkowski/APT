"""Link aktualizacji danych: czas pierwszego użycia (po nim link działa krótko).

Revision ID: 0033
Revises: 0032
"""

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("data_links", sa.Column("first_used_at", sa.DateTime(timezone=True)))
    # dotychczasowe otwarte linki: odliczanie liczymy od ostatniego użycia
    op.execute("UPDATE data_links SET first_used_at = last_used_at WHERE last_used_at IS NOT NULL")


def downgrade() -> None:
    op.drop_column("data_links", "first_used_at")
