"""Wiadomości: dłuższy typ pliku (typy MIME plików Word / Excel / PowerPoint mają ponad 50 znaków).

Revision ID: 0052
Revises: 0051
"""

import sqlalchemy as sa
from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("hr_message_files", "content_type", existing_type=sa.String(50), type_=sa.String(120))


def downgrade() -> None:
    op.alter_column("hr_message_files", "content_type", existing_type=sa.String(120), type_=sa.String(50))
