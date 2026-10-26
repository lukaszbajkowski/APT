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


def test_backup_status_for_admin(client, make_user):
    import json
    from pathlib import Path

    from app.config import get_settings

    make_user("admin", Role.admin)
    login(client, "admin")
    path = Path(get_settings().data_dir) / "backup-status.json"
    path.unlink(missing_ok=True)
    assert client.get("/api/dashboard").json()["backup"] is None
    path.write_text(
        json.dumps(
            {
                "local": {"at": "2026-10-25T02:30:05+01:00", "ok": True, "info": "2026-10-25_0230, 12M"},
                "offsite": {"at": "2026-10-25T02:30:09+01:00", "ok": False, "info": "Access denied"},
            }
        )
    )
    b = client.get("/api/dashboard").json()["backup"]
    assert b["local"]["ok"] is True and b["offsite"]["ok"] is False
    local = {"at": "2026-10-25T02:30:05+01:00", "ok": True, "info": "x"}
    path.write_text(json.dumps({"local": local, "offsite": None}))
    assert client.get("/api/dashboard").json()["backup"]["offsite"] is None
    path.unlink()

    make_user("kadry", Role.hr)
    other = TestClient(app)
    login(other, "kadry")
    assert other.get("/api/dashboard").json()["backup"] is None


def test_upcoming_events(admin_client):
    from datetime import date, timedelta

    from tests.test_trainings import _emp, _types

    c = admin_client
    today = date.today()
    st = _types(c)["Szkolenie stanowiskowe"]["id"]
    e = _emp(c, hire_date=(today + timedelta(days=3)).isoformat())
    body = {
        "type_id": st,
        "name": "Prasa",
        "start_date": (today - timedelta(days=5)).isoformat(),
        "exam_date": (today + timedelta(days=2)).isoformat(),
        "standard_days": 10,
    }
    c.post(f"/api/employees/{e['id']}/trainings", json=body)
    ev = c.get("/api/dashboard/upcoming").json()
    assert [(x["kind"], x["date"]) for x in ev] == [
        ("exam", (today + timedelta(days=2)).isoformat()),
        ("hire", (today + timedelta(days=3)).isoformat()),
        ("standard_end", (today + timedelta(days=5)).isoformat()),
    ]
    assert ev[0]["title"] == "Egzamin: Prasa" and ev[0]["employee"] == "Nowak Ola"
