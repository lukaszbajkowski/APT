"""Dokumenty: szablony .docx i wygenerowane dokumenty.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, unique=True),
        sa.Column("description", sa.Text),
        sa.Column("language", sa.String(5), nullable=False, server_default="pl"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("file_name", sa.String(200), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("variables", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("fields", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("sensitive", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "employee_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("template_id", sa.Integer, sa.ForeignKey("templates.id", ondelete="SET NULL")),
        sa.Column("template_name", sa.String(200), nullable=False),
        sa.Column("template_version", sa.Integer, nullable=False),
        sa.Column("has_pdf", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_by_name", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_documents_employee_id", "documents", ["employee_id"])


def downgrade() -> None:
    op.drop_table("documents")
    op.drop_table("templates")
