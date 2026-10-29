"""Dokumenty pobytowe i uprawniające do pracy cudzoziemców (terminy ważności).

Revision ID: 0039
Revises: 0038
"""

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_permits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("created_by_name", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_work_permits_employee_id", "work_permits", ["employee_id"])
    op.create_index("ix_work_permits_valid_until", "work_permits", ["valid_until"])


def downgrade() -> None:
    op.drop_table("work_permits")
