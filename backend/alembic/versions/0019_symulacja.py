"""Symulacja uprawnień przez administratora (rola zapisana w sesji).

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_sessions", sa.Column("sim_role", sa.String(20)))
    op.add_column("user_sessions", sa.Column("sim_agency_id", sa.Integer()))
    op.add_column("user_sessions", sa.Column("sim_department_id", sa.Integer()))


def downgrade() -> None:
    op.drop_column("user_sessions", "sim_department_id")
    op.drop_column("user_sessions", "sim_agency_id")
    op.drop_column("user_sessions", "sim_role")
