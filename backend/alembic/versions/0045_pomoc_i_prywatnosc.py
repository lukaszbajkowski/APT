"""Pomoc i prywatność: kontakt w sprawie aplikacji i informacja o przetwarzaniu danych.

Revision ID: 0045
Revises: 0044
"""

import sqlalchemy as sa
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_info",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("contact_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("contact_email", sa.String(200), nullable=False, server_default=""),
        sa.Column("contact_phone", sa.String(40), nullable=False, server_default=""),
        sa.Column("contact_hours", sa.String(120), nullable=False, server_default=""),
        sa.Column("privacy_text", sa.Text, nullable=False, server_default=""),
        sa.Column("updated_by_name", sa.String(200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("site_info")
