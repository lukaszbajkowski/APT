"""Konta pracowników: wyłącznie klucz dostępu (usuwa hasła i kody 2FA założone w testach).

Revision ID: 0026
Revises: 0025
"""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users
           SET password_hash = '!', totp_secret_enc = NULL, totp_enabled_at = NULL,
               totp_last_step = NULL, recovery_codes = '[]'::jsonb
         WHERE role = 'employee'
        """
    )


def downgrade() -> None:
    pass
