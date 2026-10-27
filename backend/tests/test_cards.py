import io
from datetime import date

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.cards import CARD_H, CARD_W
from app.db import SessionLocal
from app.main import app
from app.models import Agency, AuditLog, Department, Role, UserScope
from tests.conftest import login


@pytest.fixture
def setup(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    with SessionLocal() as db:
        a1, a2 = Agency(name="Agencja A"), Agency(name="Agencja B")
        d1, d2 = Department(name="Montaż"), Department(name="Magazyn")
        db.add_all([a1, a2, d1, d2])
        db.commit()
        ids = {"a1": a1.id, "a2": a2.id, "d1": d1.id, "d2": d2.id}
    e1 = client.post(
        "/api/employees",
        json={
            "first_name": "Jan",
            "last_name": "Kowalski",
            "agency_id": ids["a1"],
            "department_id": ids["d1"],
        },
    ).json()
    e2 = client.post(
        "/api/employees",
        json={
            "first_name": "Maria",
            "last_name": "Wiśniewska-Żółkiewska",
            "agency_id": ids["a2"],
            "department_id": ids["d2"],
        },
    ).json()
    buf = io.BytesIO()
    Image.new("RGB", (900, 1200), (180, 120, 90)).save(buf, "JPEG")
    client.put(f"/api/employees/{e1['id']}/photo", files={"file": ("a.jpg", buf.getvalue(), "image/jpeg")})
    return client, e1, e2, ids


def _pages(pdf: bytes) -> list[tuple[float, float]]:
    from pypdf import PdfReader

    return [(float(p.mediabox.width), float(p.mediabox.height)) for p in PdfReader(io.BytesIO(pdf)).pages]


def test_cr80_one_card_per_page(setup):
    c, e1, e2, _ = setup
    r = c.post("/api/cards/pdf", json={"employee_ids": [e1["id"], e2["id"]], "layout": "cr80"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"
    pages = _pages(r.content)
    assert len(pages) == 2
    assert pages[0] == pytest.approx((CARD_W, CARD_H), abs=0.01)


def test_a4_ten_cards_per_sheet_and_audit(setup):
    c, e1, e2, _ = setup
    ids = [e1["id"], e2["id"]] * 6  # duplikaty są usuwane
    r = c.post("/api/cards/pdf", json={"employee_ids": ids, "layout": "a4", "valid_until": "2027-12-31"})
    assert r.status_code == 200
    assert len(_pages(r.content)) == 1
    assert 'filename="karty_2.pdf"' in r.headers["content-disposition"]
    with SessionLocal() as db:
        acts = list(db.scalars(select(AuditLog.action)))
    assert acts.count("cards_printed") == 1
    assert acts.count("card_printed") == 2


def test_check_reports_missing_photos(setup):
    c, e1, e2, _ = setup
    r = c.post("/api/cards/check", json={"employee_ids": [e1["id"], e2["id"]]})
    body = r.json()
    assert body["count"] == 2
    assert [p["id"] for p in body["without_photo"]] == [e2["id"]]


def test_manager_prints_only_own_scope(setup, make_user):
    c, e1, e2, ids = setup
    mgr = make_user("kierownik", Role.manager)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, department_id=ids["d1"]))
        db.commit()
    m = TestClient(app)
    login(m, "kierownik")
    assert m.post("/api/cards/pdf", json={"employee_ids": [e1["id"]]}).status_code == 200
    assert m.post("/api/cards/pdf", json={"employee_ids": [e1["id"], e2["id"]]}).status_code == 404


def test_viewer_cannot_print(setup, make_user):
    _, e1, _, _ = setup
    make_user("podglad", Role.viewer)
    v = TestClient(app)
    login(v, "podglad")
    assert v.post("/api/cards/pdf", json={"employee_ids": [e1["id"]]}).status_code == 403


def test_validation(setup):
    c, *_ = setup
    assert c.post("/api/cards/pdf", json={"employee_ids": []}).status_code == 422
    assert c.post("/api/cards/pdf", json={"employee_ids": [1], "layout": "a3"}).status_code == 422
    assert date.today()  # sanity
