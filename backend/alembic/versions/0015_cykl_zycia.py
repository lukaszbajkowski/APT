"""Cykl życia pracownika: historia przydziałów, okresy zatrudnienia, checklisty wdrożenia i odejścia.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    fk = {"ondelete": "CASCADE"}
    op.create_table(
        "employment_periods",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("employee_id", sa.Integer, sa.ForeignKey("employees.id", **fk), nullable=False, index=True),
        sa.Column("hire_date", sa.Date),
        sa.Column("termination_date", sa.Date),
        sa.Column("agency_name", sa.String(200)),
        sa.Column("department_name", sa.String(200)),
        sa.Column("position_name", sa.String(200)),
    )
    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("employee_id", sa.Integer, sa.ForeignKey("employees.id", **fk), nullable=False, index=True),
        sa.Column("valid_from", sa.Date, nullable=False),
        sa.Column("agency_name", sa.String(200)),
        sa.Column("department_name", sa.String(200)),
        sa.Column("position_name", sa.String(200)),
        sa.Column("reason", sa.String(50)),
        sa.Column("changed_by_name", sa.String(200)),
        _ts(),
    )
    # stan obecny jako pierwszy wpis historii
    op.execute(
        """
        INSERT INTO assignments (employee_id, valid_from, agency_name, department_name, position_name, reason)
        SELECT e.id, COALESCE(e.hire_date, e.created_at::date), a.name, d.name, p.name, 'stan początkowy'
        FROM employees e
        LEFT JOIN agencies a ON a.id = e.agency_id
        LEFT JOIN departments d ON d.id = e.department_id
        LEFT JOIN positions p ON p.id = e.position_id
        """
    )
    op.create_table(
        "checklist_template_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("responsible", sa.String(10), nullable=False, server_default="hr"),
        sa.Column("due_days", sa.Integer, nullable=False, server_default="0"),
        sa.Column("auto", sa.String(40)),
        sa.Column("sort", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        _ts(),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("employee_id", sa.Integer, sa.ForeignKey("employees.id", **fk), nullable=False, index=True),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("responsible", sa.String(10), nullable=False, server_default="hr"),
        sa.Column("due_date", sa.Date),
        sa.Column("auto", sa.String(40)),
        sa.Column("sort", sa.Integer, nullable=False, server_default="0"),
        sa.Column("done_at", sa.DateTime(timezone=True)),
        sa.Column("done_by_name", sa.String(200)),
        sa.Column("skipped", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("note", sa.String(500)),
        _ts(),
    )
    conn = op.get_bind()

    def type_id(name: str) -> str | None:
        r = conn.execute(sa.text("SELECT id FROM training_types WHERE name = :n"), {"n": name}).scalar()
        return f"training:{r}" if r else None

    seed = [
        ("onboarding", "Badania lekarskie wstępne", "hr", -3, type_id("Badania lekarskie okresowe")),
        ("onboarding", "Szkolenie BHP wstępne", "hr", 0, type_id("Szkolenie BHP wstępne")),
        ("onboarding", "Zdjęcie do karty", "hr", 0, "photo"),
        ("onboarding", "Wydruk karty identyfikacyjnej", "hr", 1, "card"),
        (
            "onboarding",
            "Rozpoczęcie szkolenia stanowiskowego",
            "manager",
            1,
            type_id("Szkolenie stanowiskowe"),
        ),
        ("onboarding", "Deklaracja Medicover", "hr", 7, None),
        ("offboarding", "Zwrot karty identyfikacyjnej", "manager", 0, None),
        ("offboarding", "Rozliczenie odzieży i sprzętu", "manager", 0, None),
        ("offboarding", "Wypisanie z Medicover", "hr", 7, None),
    ]
    t = sa.table(
        "checklist_template_items",
        sa.column("kind"),
        sa.column("label"),
        sa.column("responsible"),
        sa.column("due_days"),
        sa.column("auto"),
        sa.column("sort"),
    )
    op.bulk_insert(
        t,
        [
            {"kind": k, "label": label, "responsible": r, "due_days": d, "auto": a, "sort": i}
            for i, (k, label, r, d, a) in enumerate(seed)
        ],
    )


def downgrade() -> None:
    op.drop_table("checklist_items")
    op.drop_table("checklist_template_items")
    op.drop_table("assignments")
    op.drop_table("employment_periods")
