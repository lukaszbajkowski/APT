"""Komunikaty: rodzaj (informacja albo dokument do zapoznania się).

Revision ID: 0041
Revises: 0040
"""

import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("broadcasts", sa.Column("kind", sa.String(10), nullable=False, server_default="info"))


def downgrade() -> None:
    op.drop_column("broadcasts", "kind")
