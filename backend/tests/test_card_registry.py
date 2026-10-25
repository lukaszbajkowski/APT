from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import cardreg
from app.db import SessionLocal
from app.models import Agency, AuditLog, Card, Role, UserScope
from tests.conftest import login


def _emp(c, last="Nowak"):
    return c.post("/api/employees", json={"first_name": "Jan", "last_name": last}).json()


def _print(c, ids, valid_until=None):
    body = {"employee_ids": ids, "layout": "cr80"}
    if valid_until:
        body["valid_until"] = valid_until
    r = c.post("/api/cards/pdf", json=body)
    assert r.status_code == 200, r.text
    return r


def test_parse_code():
    assert cardreg.parse_code("000123-2") == (123, 2)
    assert cardreg.parse_code(" 123 ") == (123, None)
    assert cardreg.parse_code("000123/4") == (123, 4)
    assert cardreg.parse_code("abc") is None
    assert cardreg.qr_payload(7, 3) == "000007-3"


def test_print_issues_and_replaces(admin_client):
    c = admin_client
    e = _emp(c)
    _print(c, [e["id"]])
    chk = c.post("/api/cards/check", json={"employee_ids": [e["id"]]}).json()
    assert [p["id"] for p in chk["replacing"]] == [e["id"]]
    _print(c, [e["id"]])
    cards = c.get(f"/api/cards/employee/{e['id']}").json()
    assert [(x["version"], x["state"]) for x in cards] == [(2, "valid"), (1, "replaced")]
    assert cards[0]["code"] == f"{e['number_display']}-2"
    assert cards[0]["issued_by_name"]

    assert c.get(f"/api/cards/scan/{e['number_display']}-2").json()["result"] == "valid"
    old = c.get(f"/api/cards/scan/{e['number_display']}-1").json()
    assert old["result"] == "replaced" and old["current_card"]["version"] == 2
    assert c.get(f"/api/cards/scan/{e['number_display']}-9").json()["result"] == "unknown_card"
    assert c.get(f"/api/cards/scan/{e['number_display']}").json()["result"] == "legacy"
    assert c.get(f"/api/cards/scan/{e['number_display']}?manual=true").json()["result"] == "manual"
    assert c.get("/api/cards/scan/999999-1").status_code == 404
    assert c.get("/api/cards/scan/xyz").status_code == 400


def test_revoke_lost_card(admin_client):
    c = admin_client
    e = _emp(c)
    _print(c, [e["id"]])
    card = c.get(f"/api/cards/employee/{e['id']}").json()[0]
    r = c.post(f"/api/cards/{card['id']}/revoke", json={"reason": "lost", "note": "zgłoszenie 25.10"})
    assert r.status_code == 200 and r.json()["state"] == "revoked"
    assert c.post(f"/api/cards/{card['id']}/revoke", json={"reason": "lost"}).status_code == 409
    s = c.get(f"/api/cards/scan/{card['code']}").json()
    assert s["result"] == "revoked" and s["card"]["revoke_reason"] == "lost" and s["current_card"] is None
    with SessionLocal() as db:
        assert db.scalar(select(AuditLog).where(AuditLog.action == "card_revoked")) is not None


def test_expired_and_filters(admin_client):
    c = admin_client
    a, b, n = _emp(c, "A"), _emp(c, "B"), _emp(c, "Bez")
    _print(c, [a["id"]], (date.today() + timedelta(days=10)).isoformat())
    _print(c, [b["id"]], (date.today() + timedelta(days=200)).isoformat())
    with SessionLocal() as db:
        card = db.scalar(select(Card).where(Card.employee_id == b["id"]))
        card.valid_until = date.today() - timedelta(days=1)
        db.commit()
    assert c.get(f"/api/cards/scan/{b['number_display']}-1").json()["result"] == "expired"

    def names(**params):
        return [x["last_name"] for x in c.get("/api/employees", params=params).json()["items"]]

    assert names(card="expiring") == ["A"]
    assert names(card="expired") == ["B"]
    assert names(card="none") == ["B", "Bez"]
    d = c.get("/api/dashboard").json()
    assert (d["cards_expiring"], d["cards_expired"], d["cards_printed_30_days"]) == (1, 1, 2)


def test_termination_revokes_card(admin_client):
    c = admin_client
    e = _emp(c)
    _print(c, [e["id"]])
    c.post(f"/api/employees/{e['id']}/terminate", json={"termination_date": date.today().isoformat()})
    card = c.get(f"/api/cards/employee/{e['id']}").json()[0]
    assert card["state"] == "revoked" and card["revoke_reason"] == "termination"


def test_manager_scope(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    with SessionLocal() as db:
        db.add_all([Agency(name="A"), Agency(name="B")])
        db.commit()
    mine = client.post("/api/employees", json={"first_name": "J", "last_name": "Moj", "agency_id": 1}).json()
    other = client.post(
        "/api/employees", json={"first_name": "J", "last_name": "Obcy", "agency_id": 2}
    ).json()
    _print(client, [mine["id"], other["id"]])
    cards = {x["id"]: client.get(f"/api/cards/employee/{x['id']}").json()[0] for x in (mine, other)}

    mgr = make_user("kier", Role.manager)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, agency_id=1))
        db.commit()
    m = TestClient(client.app)
    login(m, "kier")
    assert m.get(f"/api/cards/scan/{cards[mine['id']]['code']}").json()["result"] == "valid"
    assert m.get(f"/api/cards/scan/{cards[other['id']]['code']}").status_code == 404
    assert m.post(f"/api/cards/{cards[other['id']]['id']}/revoke", json={"reason": "lost"}).status_code == 404
    assert (
        m.post(f"/api/cards/{cards[mine['id']]['id']}/revoke", json={"reason": "damaged"}).status_code == 200
    )
