"""Podpisy: potwierdzenie blokadą urządzenia (WebAuthn) i wynik weryfikacji podpisu kwalifikowanego.

Revision ID: 0022
Revises: 0021
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_signatures",
        sa.Column("device_check", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("document_signatures", sa.Column("device_challenge", sa.String(64)))
    op.add_column("document_signatures", sa.Column("device_credential", sa.String(300)))
    op.add_column("document_signatures", sa.Column("device_verified_at", sa.DateTime(timezone=True)))
    op.add_column("document_signatures", sa.Column("check_result", postgresql.JSONB()))


def downgrade() -> None:
    for c in ("check_result", "device_verified_at", "device_credential", "device_challenge", "device_check"):
        op.drop_column("document_signatures", c)
