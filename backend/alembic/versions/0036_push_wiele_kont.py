"""Push: jedna przeglądarka może odbierać powiadomienia dla kilku kont (unikalna para konto + urządzenie).

Revision ID: 0036
Revises: 0035
"""

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("push_subscriptions_endpoint_key", "push_subscriptions", type_="unique")
    op.create_unique_constraint("uq_push_user_endpoint", "push_subscriptions", ["user_id", "endpoint"])
    op.create_index(
        "ix_push_subscriptions_endpoint", "push_subscriptions", ["endpoint"], postgresql_using="hash"
    )


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_endpoint", table_name="push_subscriptions")
    op.drop_constraint("uq_push_user_endpoint", "push_subscriptions", type_="unique")
    op.create_unique_constraint("push_subscriptions_endpoint_key", "push_subscriptions", ["endpoint"])
