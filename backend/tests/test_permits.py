from datetime import date, timedelta

from app.models import Role


def _emp(c) -> int:
    r = c.post("/api/employees", json={"first_name": "Oleh", "last_name": "Kowal"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_permit_flow_and_report(admin_client):
    c = admin_client
    eid = _emp(c)
    soon = (date.today() + timedelta(days=20)).isoformat()
    far = (date.today() + timedelta(days=400)).isoformat()
    r = c.post(f"/api/employees/{eid}/permits", json={"kind": "karta_pobytu", "valid_until": soon})
    assert r.status_code == 201 and r.json()["state"] == "expiring"
    c.post(f"/api/employees/{eid}/permits", json={"kind": "wiza", "valid_until": far})
    bad = c.post(
        f"/api/employees/{eid}/permits",
        json={"kind": "wiza", "valid_from": far, "valid_until": soon},
    )
    assert bad.status_code == 400
    rows = c.get("/api/permits/report").json()
    assert [x["kind_label"] for x in rows] == ["karta pobytu"]
    assert len(c.get("/api/permits/report?only_problems=false").json()) == 2
    ev = c.get("/api/dashboard/upcoming?days=30").json()
    assert any(x["kind"] == "permit" for x in ev)
    pid = c.get(f"/api/employees/{eid}/permits").json()[0]["id"]
    assert c.delete(f"/api/permits/{pid}").status_code == 204


def test_permits_forbidden_for_manager(client, make_user):
    from tests.conftest import login

    make_user("kier", Role.manager)
    login(client, "kier")
    assert client.get("/api/permits/report").status_code == 403


def test_permit_reminders(admin_client, make_user):
    from app import mailer
    from app.cli import permit_reminders
    from app.config import get_settings

    s = get_settings()
    s.smtp_host = "smtp.test"
    mailer.outbox = []
    try:
        c = admin_client
        eid = _emp(c)
        past = (date.today() - timedelta(days=3)).isoformat()
        c.post(f"/api/employees/{eid}/permits", json={"kind": "zezwolenie_na_prace", "valid_until": past})
        assert permit_reminders() == 0
    finally:
        s.smtp_host = ""
        mailer.outbox = None
