"""Podpis elektroniczny dokumentów: prośby o podpis, podpisy, podpisany PDF.

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("signature_roles", JSONB, nullable=False, server_default="[]"))
    op.add_column("documents", sa.Column("signed_at", sa.DateTime(timezone=True)))
    op.add_column(
        "documents", sa.Column("has_signed_pdf", sa.Boolean, nullable=False, server_default=sa.false())
    )
    op.create_table(
        "document_signatures",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("token_hash", sa.String(64), unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("channel", sa.String(10), nullable=False, server_default="link"),
        sa.Column("sent_to", sa.String(254)),
        sa.Column("signer_name", sa.String(200)),
        sa.Column("method", sa.String(10)),
        sa.Column("file_name", sa.String(200)),
        sa.Column("original_name", sa.String(255)),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ip", INET),
        sa.Column("user_agent", sa.String(400)),
        sa.Column("requested_by_name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_document_signatures_document_id", "document_signatures", ["document_id"])


def downgrade() -> None:
    op.drop_table("document_signatures")
    op.drop_column("documents", "has_signed_pdf")
    op.drop_column("documents", "signed_at")
    op.drop_column("documents", "signature_roles")
