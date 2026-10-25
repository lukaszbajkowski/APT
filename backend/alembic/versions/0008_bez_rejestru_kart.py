"""Rezygnacja z rejestru kart – usunięcie tabeli cards.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cards")
    op.execute("DROP TYPE IF EXISTS card_status")


def downgrade() -> None:
    pass
