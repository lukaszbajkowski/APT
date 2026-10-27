"""Konta pracowników: rola „employee”, powiązanie z kartoteką, klucze dostępu (WebAuthn).

Revision ID: 0024
Revises: 0023
"""

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'employee'")
    op.add_column(
        "users",
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE")),
    )
    op.create_unique_constraint("uq_users_employee_id", "users", ["employee_id"])
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        ),
        sa.Column("credential_id", sa.String(400), nullable=False, unique=True),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(100), nullable=False, server_default="Klucz dostępu"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "webauthn_challenges",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("challenge", sa.String(100), nullable=False),
        sa.Column("purpose", sa.String(10), nullable=False),  # login | register
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("webauthn_challenges")
    op.drop_table("webauthn_credentials")
    op.drop_constraint("uq_users_employee_id", "users", type_="unique")
    op.drop_column("users", "employee_id")
