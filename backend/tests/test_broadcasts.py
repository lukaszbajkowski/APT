from app import mailer, push
from app.db import SessionLocal
from app.models import Employee
from tests.test_accounts import emp, hr  # noqa: F401, F811
from tests.test_me import me  # noqa: F401


def test_broadcast_flow(me, hr, emp):  # noqa: F811
    ag = hr.post("/api/agencies", json={"name": "Agencja Z"}).json()
    with SessionLocal() as db:
        db.get(Employee, emp).agency_id = ag["id"]
        db.commit()
    mailer.outbox, push.outbox = [], []
    assert hr.post("/api/broadcasts/preview", json={}).status_code == 400
    p = hr.post("/api/broadcasts/preview", json={"agency_id": ag["id"]}).json()
    assert p["total"] == 1 and p["with_account"] == 1
    r = hr.post(
        "/api/broadcasts",
        json={
            "subject": "Zmiana godzin",
            "body": "Od jutra zmiana zaczyna się o 6:00.",
            "agency_id": ag["id"],
        },
    )
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    assert r.json()["total"] == 1 and r.json()["read"] == 0
    # pracownik widzi komunikat i potwierdza
    assert me.get("/api/me/broadcasts/count").json() == {"unread": 1}
    mine = me.get("/api/me/broadcasts").json()
    assert mine[0]["subject"] == "Zmiana godzin" and mine[0]["read_at"] is None
    assert me.post(f"/api/me/broadcasts/{bid}/read").status_code == 204
    assert me.get("/api/me/broadcasts/count").json() == {"unread": 0}
    assert hr.get("/api/broadcasts").json()[0]["read"] == 1
    assert hr.get(f"/api/broadcasts/{bid}/recipients").json()[0]["read_at"] is not None
    # dokument do zapoznania się + przypomnienie
    d = hr.post(
        "/api/broadcasts",
        json={"kind": "document", "subject": "Regulamin", "body": "x" * 5000, "agency_id": ag["id"]},
    )
    assert d.status_code == 201 and d.json()["kind"] == "document"
    assert (
        hr.post(
            "/api/broadcasts", json={"subject": "a", "body": "x" * 2001, "agency_id": ag["id"]}
        ).status_code
        == 400
    )
    assert hr.post(f"/api/broadcasts/{d.json()['id']}/remind").json()["unread"] == 1
    # pracownik nie ma dostępu do funkcji kadr
    assert me.post("/api/broadcasts/preview", json={"everyone": True}).status_code == 403
