from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Agency, Role, UserScope
from tests.conftest import login


def test_dashboard_counts_respect_scope(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    with SessionLocal() as db:
        db.add_all([Agency(name="A"), Agency(name="B")])
        db.commit()
    a = client.post("/api/employees", json={"first_name": "Jan", "last_name": "A", "agency_id": 1}).json()
    client.post("/api/employees", json={"first_name": "Ola", "last_name": "B", "agency_id": 2})
    client.post(f"/api/employees/{a['id']}/terminate", json={"termination_date": "2026-10-01"})

    d = client.get("/api/dashboard").json()
    assert (d["active"], d["terminated"], d["added_30_days"], d["without_photo"]) == (1, 1, 2, 1)
    assert d["without_pesel"] == 1
    assert [e["last_name"] for e in d["recent"]] == ["B", "A"]

    mgr = make_user("kierownik", Role.manager)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, agency_id=2))
        db.commit()
    m = TestClient(app)
    login(m, "kierownik")
    d = m.get("/api/dashboard").json()
    assert (d["active"], d["terminated"]) == (1, 0)
    assert d["without_pesel"] is None
    assert [e["last_name"] for e in d["recent"]] == ["B"]
