"""E-mail użytkownika i jednorazowe linki do ustawienia hasła.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(254)))
    op.create_unique_constraint("uq_users_email", "users", ["email"])
    op.create_table(
        "password_tokens",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("purpose", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_password_tokens_user_id", "password_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_table("password_tokens")
    op.drop_constraint("uq_users_email", "users")
    op.drop_column("users", "email")
