"""Rejestr wydanych kart identyfikacyjnych.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

card_status = sa.Enum("active", "replaced", "revoked", name="card_status")


def upgrade() -> None:
    op.create_table(
        "cards",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "employee_id", sa.Integer, sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("status", card_status, nullable=False, server_default="active"),
        sa.Column("layout", sa.String(8), nullable=False),
        sa.Column("valid_until", sa.Date),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("issued_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("closed_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("revoke_reason", sa.String(20)),
        sa.Column("revoke_note", sa.String(300)),
        sa.UniqueConstraint("employee_id", "version", name="uq_cards_employee_version"),
    )
    op.create_index("ix_cards_employee_id", "cards", ["employee_id"])
    op.create_index(
        "uq_cards_one_active",
        "cards",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_table("cards")
    card_status.drop(op.get_bind(), checkfirst=True)
