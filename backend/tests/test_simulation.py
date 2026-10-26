from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, Role
from tests.conftest import login


def test_admin_simulates_roles(admin_client):
    c = admin_client
    a = c.post("/api/agencies", json={"name": "APT Sim"}).json()
    c.post("/api/employees", json={"first_name": "Jan", "last_name": "Wewnątrz", "agency_id": a["id"]})
    c.post("/api/employees", json={"first_name": "Ola", "last_name": "Poza"})
    assert c.get("/api/users").status_code == 200

    # kadry: brak dostępu do użytkowników, pracownicy widoczni
    me = c.post("/api/auth/simulate", json={"role": "hr"}).json()
    assert me["user"]["role"] == "hr" and me["real_role"] == "admin" and me["sim_role"] == "hr"
    assert c.get("/api/auth/me").json()["user"]["role"] == "hr"
    assert c.get("/api/users").status_code == 403

    # kierownik z zakresem APT: widzi tylko swoich
    c.post("/api/auth/simulate", json={"role": "manager", "agency_id": a["id"]})
    names = [x["last_name"] for x in c.get("/api/employees").json()["items"]]
    assert names == ["Wewnątrz"]

    # koniec symulacji
    me = c.post("/api/auth/simulate", json={"role": None}).json()
    assert me["user"]["role"] == "admin" and me["sim_role"] is None
    assert c.get("/api/users").status_code == 200
    with SessionLocal() as db:
        logs = list(db.scalars(select(AuditLog).where(AuditLog.action == "role_simulation")))
        assert len(logs) == 3 and all(x.username == "admin" for x in logs)


def test_simulation_only_for_admin(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    assert client.post("/api/auth/simulate", json={"role": "viewer"}).status_code == 403


def test_admin_simulates_agency(admin_client):
    c = admin_client
    a = c.post("/api/agencies", json={"name": "APT Sim"}).json()
    c.post("/api/employees", json={"first_name": "Jan", "last_name": "Wewnątrz", "agency_id": a["id"]})
    c.post("/api/employees", json={"first_name": "Ola", "last_name": "Poza"})
    assert c.post("/api/auth/simulate", json={"role": "agency"}).status_code == 400  # trzeba wybrać APT
    me = c.post("/api/auth/simulate", json={"role": "agency", "agency_id": a["id"]}).json()
    assert me["user"]["role"] == "agency" and me["sim_agency_id"] == a["id"]
    assert [x["last_name"] for x in c.get("/api/employees").json()["items"]] == ["Wewnątrz"]
    assert c.get("/api/agency-report", params={"month": "2026-09"}).json()["agency"] == "APT Sim"
    c.post("/api/auth/simulate", json={"role": None})
    assert len(c.get("/api/employees").json()["items"]) == 2
