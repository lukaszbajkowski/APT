from app.models import Role
from tests.conftest import login


def test_staff_can_manage_agencies(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    r = client.post("/api/agencies", json={"name": "  Agencja Pierwsza ", "code": ""})
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["name"] == "Agencja Pierwsza"
    assert a["code"] is None

    assert client.post("/api/agencies", json={"name": "Agencja Pierwsza"}).status_code == 409

    r = client.patch(f"/api/agencies/{a['id']}", json={"is_active": False, "code": "AP1"})
    assert r.status_code == 200
    assert r.json()["is_active"] is False

    assert [x["name"] for x in client.get("/api/agencies").json()] == ["Agencja Pierwsza"]
    assert client.get("/api/agencies", params={"active_only": True}).json() == []


def test_viewer_and_manager_cannot_edit_dictionaries(client, make_user):
    for role in (Role.viewer, Role.manager):
        make_user(role.value, role)
        login(client, role.value)
        assert client.post("/api/departments", json={"name": "X"}).status_code == 403
        assert client.get("/api/departments").status_code == 200
        client.post("/api/auth/logout")


def test_positions_with_department(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    d = client.post("/api/departments", json={"name": "Montaż"}).json()
    d2 = client.post("/api/departments", json={"name": "Magazyn"}).json()
    p1 = client.post("/api/positions", json={"name": "Operator", "department_id": d["id"]}).json()
    client.post("/api/positions", json={"name": "Operator", "department_id": d2["id"]})
    client.post("/api/positions", json={"name": "Sprzątanie"})
    assert (
        client.post("/api/positions", json={"name": "Operator", "department_id": d["id"]}).status_code == 409
    )
    assert client.post("/api/positions", json={"name": "Y", "department_id": 999}).status_code == 400

    names = [
        (p["name"], p["department_id"])
        for p in client.get("/api/positions", params={"department_id": d["id"]}).json()
    ]
    assert names == [("Operator", d["id"]), ("Sprzątanie", None)]
    assert p1["is_active"] is True


def test_countries_seeded_poland_first(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    countries = client.get("/api/countries").json()
    assert countries[0]["iso_code"] == "PL"
    assert any(c["name"] == "Ukraina" for c in countries)
    r = client.post("/api/countries", json={"name": "Testlandia", "iso_code": "xq"})
    assert r.status_code == 201, r.text
    assert r.json()["iso_code"] == "XQ"
    r = client.post("/api/countries", json={"name": "Testowo", "iso_code": "PL"})
    assert r.status_code == 409


def test_position_without_department_unique(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    assert client.post("/api/positions", json={"name": "Sprzątanie"}).status_code == 201
    assert client.post("/api/positions", json={"name": "Sprzątanie"}).status_code == 409
