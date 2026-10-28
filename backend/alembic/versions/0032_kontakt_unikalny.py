"""Kontakt pracownika: skróty telefonu i e-maila – jeden kontakt tylko dla jednego pracownika.

Revision ID: 0032
Revises: 0031
"""

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("phone_hash", sa.String(64), unique=True))
    op.add_column("employees", sa.Column("email_hash", sa.String(64), unique=True))
    # uzupełnienie dla już zapisanych kontaktów; przy duplikacie skrót dostaje tylko pierwszy z nich
    from app import crypto

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, phone_enc, email_enc FROM employees "
            "WHERE phone_enc IS NOT NULL OR email_enc IS NOT NULL ORDER BY id"
        )
    ).fetchall()
    seen: set[str] = set()
    for emp_id, phone_enc, email_enc in rows:
        for kind, blob in (("phone", phone_enc), ("email", email_enc)):
            if blob is None:
                continue
            try:
                h = crypto.contact_hash(kind, crypto.decrypt_contact(bytes(blob)))
            except ValueError:
                continue
            if h in seen:
                continue
            seen.add(h)
            bind.execute(
                sa.text(f"UPDATE employees SET {kind}_hash = :h WHERE id = :i"), {"h": h, "i": emp_id}
            )


def downgrade() -> None:
    op.drop_column("employees", "email_hash")
    op.drop_column("employees", "phone_hash")
