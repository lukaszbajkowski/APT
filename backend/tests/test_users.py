from sqlalchemy import select

from app.db import SessionLocal
from app.models import Agency, AuditLog, Department, Role
from tests.conftest import login


def _dicts() -> tuple[int, int]:
    with SessionLocal() as db:
        a = Agency(code="APT1", name="Agencja Pierwsza")
        d = Department(code="W1", name="Wydział Montażu")
        db.add_all([a, d])
        db.commit()
        return a.id, d.id


def test_non_admin_cannot_manage_users(client, make_user):
    for role in (Role.hr, Role.manager, Role.viewer):
        make_user(role.value, role)
        login(client, role.value)
        assert client.get("/api/users").status_code == 403
        r = client.post("/api/users", json={"username": "x-user", "full_name": "X", "role": "hr"})
        assert r.status_code == 403
        client.post("/api/auth/logout")


def test_create_user_returns_temporary_password(admin_client, client):
    r = admin_client.post(
        "/api/users",
        json={"username": "Anna.Nowak", "full_name": "Anna Nowak", "role": "hr"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["username"] == "anna.nowak"
    assert body["user"]["must_change_password"] is True
    temp = body["temporary_password"]

    admin_client.post("/api/auth/logout")
    me = login(client, "anna.nowak", temp)
    assert me["user"]["must_change_password"] is True


def test_duplicate_username_rejected(admin_client):
    payload = {"username": "anna", "full_name": "Anna Nowak", "role": "hr"}
    assert admin_client.post("/api/users", json=payload).status_code == 201
    assert admin_client.post("/api/users", json=payload).status_code == 409


def test_invalid_username_rejected(admin_client):
    r = admin_client.post("/api/users", json={"username": "a b", "full_name": "X Y", "role": "hr"})
    assert r.status_code == 422


def test_manager_scopes(admin_client):
    agency_id, department_id = _dicts()
    r = admin_client.post(
        "/api/users",
        json={
            "username": "kierownik",
            "full_name": "Kierownik Zmiany",
            "role": "manager",
            "scopes": {"department_ids": [department_id]},
        },
    )
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    assert user["scopes"] == [{"agency_id": None, "department_id": department_id}]

    # Ta sama lista jeszcze raz: bez błędu UNIQUE i bez zmian
    r = admin_client.patch(f"/api/users/{user['id']}", json={"scopes": {"department_ids": [department_id]}})
    assert r.status_code == 200, r.text
    assert len(r.json()["scopes"]) == 1

    # Kierownik ma zakres tylko wydziałowy – APT jest odrzucane
    r = admin_client.patch(f"/api/users/{user['id']}", json={"scopes": {"agency_ids": [agency_id]}})
    assert r.status_code == 400

    # Usunięcie wydziału
    r = admin_client.patch(f"/api/users/{user['id']}", json={"scopes": {"department_ids": []}})
    assert r.json()["scopes"] == []

    # Zmiana roli na inną niż kierownik czyści zakres
    r = admin_client.patch(f"/api/users/{user['id']}", json={"scopes": {"department_ids": [department_id]}})
    r = admin_client.patch(f"/api/users/{user['id']}", json={"role": "viewer"})
    assert r.json()["scopes"] == []


def test_unknown_scope_rejected(admin_client):
    r = admin_client.post(
        "/api/users",
        json={
            "username": "kierownik",
            "full_name": "Kierownik",
            "role": "manager",
            "scopes": {"agency_ids": [999]},
        },
    )
    assert r.status_code == 400


def test_admin_cannot_demote_or_disable_self(admin_client):
    me = admin_client.get("/api/auth/me").json()["user"]
    assert admin_client.patch(f"/api/users/{me['id']}", json={"role": "hr"}).status_code == 400
    assert admin_client.patch(f"/api/users/{me['id']}", json={"is_active": False}).status_code == 400


def test_deactivate_revokes_sessions(admin_client, make_user):
    from fastapi.testclient import TestClient

    from app.main import app

    other = make_user("anna", Role.hr)
    c = TestClient(app)
    login(c, "anna")
    assert c.get("/api/auth/me").status_code == 200

    r = admin_client.patch(f"/api/users/{other.id}", json={"is_active": False})
    assert r.status_code == 200
    assert c.get("/api/auth/me").status_code == 401


def test_reset_password_and_unlock(admin_client, make_user, client):
    other = make_user("anna", Role.hr)
    r = admin_client.post(f"/api/users/{other.id}/reset-password")
    assert r.status_code == 200
    temp = r.json()["temporary_password"]
    assert len(temp) >= 12

    r = admin_client.post(f"/api/users/{other.id}/unlock")
    assert r.status_code == 200

    with SessionLocal() as db:
        acts = list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))
    assert "password_reset" in acts and "user_unlocked" in acts


def test_audit_endpoint(admin_client):
    admin_client.post("/api/users", json={"username": "anna", "full_name": "Anna N", "role": "hr"})
    r = admin_client.get("/api/audit", params={"action": "user_created"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["username"] == "admin"
    assert item["details"]["username"] == "anna"

    assert "login" in admin_client.get("/api/audit/actions").json()


def test_dictionaries_readable_by_any_logged_user(client, make_user):
    _dicts()
    make_user("podglad", Role.viewer)
    login(client, "podglad")
    assert [a["code"] for a in client.get("/api/agencies").json()] == ["APT1"]
    assert [d["code"] for d in client.get("/api/departments").json()] == ["W1"]
