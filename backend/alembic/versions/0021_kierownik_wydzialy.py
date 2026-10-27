"""Kierownik ma zakres tylko wydziałowy – usunięcie zakresów APT

Revision ID: 0021
Revises: 0020
"""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM user_scopes WHERE agency_id IS NOT NULL")


def downgrade() -> None:
    pass
