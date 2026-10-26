"""Checklisty: zakres pozycji szablonu (APT, wydziały) i powiązanie pozycji pracownika z szablonem.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "checklist_template_items", sa.Column("agency_ids", JSONB, nullable=False, server_default="[]")
    )
    op.add_column(
        "checklist_template_items", sa.Column("department_ids", JSONB, nullable=False, server_default="[]")
    )
    op.add_column(
        "checklist_items",
        sa.Column(
            "template_item_id",
            sa.Integer,
            sa.ForeignKey("checklist_template_items.id", ondelete="SET NULL"),
        ),
    )
    # istniejące pozycje pracowników łączymy z aktywnym szablonem po nazwie i rodzaju
    op.execute(
        """
        UPDATE checklist_items ci SET template_item_id = t.id
        FROM checklist_template_items t
        WHERE t.is_active AND t.kind = ci.kind AND t.label = ci.label
        """
    )


def downgrade() -> None:
    op.drop_column("checklist_items", "template_item_id")
    op.drop_column("checklist_template_items", "department_ids")
    op.drop_column("checklist_template_items", "agency_ids")
