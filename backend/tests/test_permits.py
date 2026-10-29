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


def test_employee_reminders(admin_client, monkeypatch):
    from datetime import UTC, datetime

    from app import cli, crypto, mailer
    from app.db import SessionLocal
    from app.models import Employee

    c = admin_client
    eid = _emp(c)
    soon = (date.today() + timedelta(days=15)).isoformat()
    c.post(f"/api/employees/{eid}/permits", json={"kind": "karta_pobytu", "valid_until": soon})
    with SessionLocal() as db:
        e = db.get(Employee, eid)
        e.email_enc = crypto.encrypt_contact("oleh@example.com")
        e.email_verified_at = datetime.now(UTC)
        db.commit()
    sent = []
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send_now", lambda to, msg: sent.append((to, msg)))
    assert cli.employee_reminders() == 0
    to, msg = sent[0]
    assert to == "oleh@example.com" and "ważne do" in msg.items[0] and "Oleh" in msg.greeting


def test_stale_accounts(make_user):
    from datetime import UTC, datetime

    from app.cli import stale_accounts
    from app.db import SessionLocal
    from app.models import User

    make_user("stary", Role.hr)
    make_user("swiezy", Role.hr)
    with SessionLocal() as db:
        from sqlalchemy import select

        old = db.scalar(select(User).where(User.username == "stary"))
        old.last_login_at = datetime.now(UTC) - timedelta(days=120)
        new = db.scalar(select(User).where(User.username == "swiezy"))
        new.last_login_at = datetime.now(UTC)
        db.commit()
    assert stale_accounts() == 1


def test_unusual_activity():
    from app.audit import audit
    from app.db import SessionLocal
    from app.routers.access_review import unusual_activity

    with SessionLocal() as db:
        for i in range(31):
            audit(db, None, "pesel_viewed", username="ktos", entity_type="employee", entity_id=i)
        for _ in range(5):
            audit(db, None, "report_exported", username="ktos")
        audit(db, None, "pesel_viewed", username="inny", entity_type="employee", entity_id=1)
        db.commit()
        out = unusual_activity(db)
    assert len(out) == 2 and all("ktos" in x for x in out)


def test_system_status(admin_client, client, make_user):
    r = admin_client.get("/api/system/status")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["version"] and "translation" in d and d["disk"] is not None
    from fastapi.testclient import TestClient

    from app.main import app
    from tests.conftest import login

    make_user("kadry", Role.hr)
    c = TestClient(app)
    login(c, "kadry")
    assert c.get("/api/system/status").status_code == 403
