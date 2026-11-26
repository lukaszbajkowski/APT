"""Wiadomości do kilku osób: osobne rozmowy z jednej wysyłki (batch_id) i wspólne rozmowy grupowe.

Revision ID: 0050
Revises: 0049
"""

import sqlalchemy as sa
from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hr_threads", sa.Column("batch_id", sa.String(32), nullable=True))
    op.add_column("hr_threads", sa.Column("batch_size", sa.Integer, nullable=True))
    op.create_index("ix_hr_threads_batch_id", "hr_threads", ["batch_id"])
    op.add_column("hr_threads", sa.Column("is_group", sa.Boolean, nullable=False, server_default=sa.false()))
    op.alter_column("hr_threads", "employee_id", existing_type=sa.Integer, nullable=True)
    op.create_table(
        "hr_thread_members",
        sa.Column(
            "thread_id", sa.Integer, sa.ForeignKey("hr_threads.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "employee_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_hr_thread_members_employee_id", "hr_thread_members", ["employee_id"])


def downgrade() -> None:
    op.drop_index("ix_hr_thread_members_employee_id", "hr_thread_members")
    op.drop_table("hr_thread_members")
    op.execute("DELETE FROM hr_threads WHERE employee_id IS NULL")
    op.alter_column("hr_threads", "employee_id", existing_type=sa.Integer, nullable=False)
    op.drop_column("hr_threads", "is_group")
    op.drop_index("ix_hr_threads_batch_id", "hr_threads")
    op.drop_column("hr_threads", "batch_size")
    op.drop_column("hr_threads", "batch_id")
