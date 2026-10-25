from fastapi.testclient import TestClient

from app import cli, mailer
from app.db import SessionLocal
from app.main import app
from app.models import Role, User, UserScope
from tests.conftest import login
from tests.test_reports import _setup


def test_quality_admin(admin_client):
    c = admin_client
    _setup(c)
    q = c.get("/api/quality").json()
    assert q["active_total"] == 2
    counts = {x["key"]: x["count"] for x in q["checks"]}
    assert counts == {"pesel": 1, "sex": 1, "photo": 2, "department": 1, "position": 2}
    by_name = {r["last_name"]: r["missing"] for r in q["rows"]}
    assert by_name["Nowak"] == ["photo", "position"]
    assert by_name["Kowal"] == ["pesel", "sex", "photo", "department", "position"]
    assert "Stara" not in by_name  # zwolnieni pomijani


def test_quality_manager_scope_and_reminders(client, make_user, monkeypatch):
    hr = make_user("kadry", Role.hr)
    login(client, "kadry")
    _setup(client)
    mgr = make_user("kier", Role.manager)
    with SessionLocal() as db:
        db.get(User, hr.id).email = "kadry@example.com"
        db.get(User, mgr.id).email = "kier@example.com"
        db.add(UserScope(user_id=mgr.id, agency_id=1))
        db.commit()
    m = TestClient(app)
    login(m, "kier")
    q = m.get("/api/quality").json()
    assert [x["key"] for x in q["checks"]] == ["sex", "photo", "department", "position"]
    assert [r["last_name"] for r in q["rows"]] == ["Nowak"]

    make_user("podglad", Role.viewer)
    v = TestClient(app)
    login(v, "podglad")
    assert v.get("/api/quality").status_code == 403

    sent = []
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send_now", lambda to, msg: sent.append((to, msg)))
    assert cli.quality_reminders() == 0
    got = {to: msg for to, msg in sent}
    assert set(got) == {"kadry@example.com", "kier@example.com"}
    assert "2 os." in got["kadry@example.com"].subject
    assert "Brak zdjęcia: 1" in got["kier@example.com"].items
