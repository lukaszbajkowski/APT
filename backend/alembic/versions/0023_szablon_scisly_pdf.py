"""Szablony: tryb ścisły – podpisany plik musi zawierać oryginalny PDF bajt w bajt.

Revision ID: 0023
Revises: 0022
"""

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "templates", sa.Column("strict_pdf", sa.Boolean(), nullable=False, server_default=sa.false())
    )


def downgrade() -> None:
    op.drop_column("templates", "strict_pdf")
