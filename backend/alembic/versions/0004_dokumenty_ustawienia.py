"""Dokumenty: dostęp kierownika, formaty pobierania, oznaczenie dokumentów z danymi wrażliwymi.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "templates", sa.Column("allow_manager", sa.Boolean, nullable=False, server_default=sa.true())
    )
    op.add_column(
        "templates", sa.Column("download_formats", sa.String(8), nullable=False, server_default="both")
    )
    op.create_check_constraint(
        "ck_templates_download_formats", "templates", "download_formats IN ('pdf', 'docx', 'both')"
    )
    op.add_column(
        "documents", sa.Column("contains_sensitive", sa.Boolean, nullable=False, server_default=sa.false())
    )
    # Dotychczasowe dokumenty z szablonów z PESEL/datą urodzenia traktujemy jako zawierające te dane.
    op.execute(
        "UPDATE documents d SET contains_sensitive = true FROM templates t "
        "WHERE d.template_id = t.id AND t.sensitive"
    )


def downgrade() -> None:
    op.drop_column("documents", "contains_sensitive")
    op.drop_constraint("ck_templates_download_formats", "templates", type_="check")
    op.drop_column("templates", "download_formats")
    op.drop_column("templates", "allow_manager")
