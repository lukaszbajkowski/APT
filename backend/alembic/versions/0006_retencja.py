"""Retencja: wstrzymanie usunięcia danych pracownika.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("retention_hold_until", sa.Date))
    op.add_column("employees", sa.Column("retention_hold_reason", sa.String(500)))


def downgrade() -> None:
    op.drop_column("employees", "retention_hold_reason")
    op.drop_column("employees", "retention_hold_until")
