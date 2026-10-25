"""Formaty pól szablonów: dla istniejących pól tekstowych ustaw domyślny format po nazwie
(np. zam_kod → kod pocztowy, tel_kom → telefon, email → e-mail).

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-25
"""

import json
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# kopia reguł z app/masks.py z chwili migracji (migracja nie powinna zależeć od późniejszych zmian kodu)
_GUESS = [
    (re.compile(r"(^|_)(kod|kod_poczt\w*|zip|postal\w*)($|_)"), "postal"),
    (re.compile(r"(^|_)(tel|telefon|phone|kom|komorka)($|_)"), "phone"),
    (re.compile(r"(^|_)(e_?mail)($|_)"), "email"),
    (re.compile(r"(^|_)nip($|_)"), "nip"),
    (re.compile(r"(^|_)regon($|_)"), "regon"),
    (re.compile(r"(^|_)(iban|nr_konta|konto|rachunek)($|_)"), "iban"),
    (re.compile(r"(^|_)(nr_dowodu|dowod|dowod_osobisty)($|_)"), "id_card"),
]


def _guess(key: str) -> str | None:
    for rx, fmt in _GUESS:
        if rx.search(key.lower()):
            return fmt
    return None


def upgrade() -> None:
    conn = op.get_bind()
    for tid, fields in conn.execute(sa.text("SELECT id, fields FROM templates")).all():
        changed = False
        for f in fields or []:
            if f.get("type", "text") == "text" and not f.get("format"):
                fmt = _guess(f.get("key", ""))
                if fmt:
                    f["format"] = fmt
                    changed = True
        if changed:
            conn.execute(
                sa.text("UPDATE templates SET fields = CAST(:f AS jsonb) WHERE id = :id"),
                {"f": json.dumps(fields), "id": tid},
            )


def downgrade() -> None:
    pass
