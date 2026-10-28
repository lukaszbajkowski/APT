"""Archiwum wiadomości „Napisz do kadr”: osobno po stronie kadr i po stronie pracownika.

Revision ID: 0037
Revises: 0036
"""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hr_threads", sa.Column("staff_archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("hr_threads", sa.Column("employee_archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("hr_threads", "employee_archived_at")
    op.drop_column("hr_threads", "staff_archived_at")
