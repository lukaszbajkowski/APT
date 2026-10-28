"""Wiadomości do kadr: znaczniki przeczytania po stronie pracownika i kadr.

Revision ID: 0029
Revises: 0028
"""

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hr_threads", sa.Column("staff_seen_at", sa.DateTime(timezone=True)))
    op.add_column("hr_threads", sa.Column("employee_seen_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("hr_threads", "employee_seen_at")
    op.drop_column("hr_threads", "staff_seen_at")
