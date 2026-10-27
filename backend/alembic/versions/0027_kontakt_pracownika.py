"""Kontakt pracownika (telefon, e-mail – szyfrowane, po potwierdzeniu kodem) i kody potwierdzające.

Revision ID: 0027
Revises: 0026
"""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("phone_enc", sa.LargeBinary()))
    op.add_column("employees", sa.Column("phone_verified_at", sa.DateTime(timezone=True)))
    op.add_column("employees", sa.Column("email_enc", sa.LargeBinary()))
    op.add_column("employees", sa.Column("email_verified_at", sa.DateTime(timezone=True)))
    op.create_table(
        "contact_verifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.String(5), nullable=False),  # phone | email
        sa.Column("value_enc", sa.LargeBinary(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("contact_verifications")
    for c in ("email_verified_at", "email_enc", "phone_verified_at", "phone_enc"):
        op.drop_column("employees", c)
