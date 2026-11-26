"""Wiadomości: zdjęcia i pliki PDF w rozmowach (szyfrowane na dysku: messages/<wątek>/<plik>).

Revision ID: 0051
Revises: 0050
"""

import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hr_message_files",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "message_id", sa.Integer, sa.ForeignKey("hr_messages.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("file_name", sa.String(100), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("width", sa.Integer, nullable=True),
        sa.Column("height", sa.Integer, nullable=True),
    )
    op.create_index("ix_hr_message_files_message_id", "hr_message_files", ["message_id"])


def downgrade() -> None:
    op.drop_index("ix_hr_message_files_message_id", "hr_message_files")
    op.drop_table("hr_message_files")
