from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text, update

from app.db import SessionLocal, engine
from app.models import AuditLog, Role, User, UserSession
from tests.conftest import PASSWORD, login


def actions() -> list[str]:
    with SessionLocal() as db:
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_login_sets_httponly_cookie_and_returns_csrf(client, make_user):
    make_user("jan", Role.hr)
    r = client.post("/api/auth/login", json={"username": "JAN ", "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["username"] == "jan"
    assert body["user"]["role"] == "hr"
    assert len(body["csrf_token"]) > 20
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert "path=/api" in set_cookie
    assert actions() == ["login"]


def test_me_requires_login(client):
    assert client.get("/api/auth/me").status_code == 401


def test_wrong_password_and_unknown_user_same_message(client, make_user):
    make_user("jan")
    r1 = client.post("/api/auth/login", json={"username": "jan", "password": "zle"})
    r2 = client.post("/api/auth/login", json={"username": "nikt", "password": "zle"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json() == r2.json()
    assert actions() == ["login_failed", "login_failed"]


def test_lockout_after_five_failures(client, make_user):
    make_user("jan")
    for _ in range(5):
        r = client.post("/api/auth/login", json={"username": "jan", "password": "zle"})
        assert r.status_code == 401
    # Nawet poprawne hasło nie działa, dopóki konto jest zablokowane.
    r = client.post("/api/auth/login", json={"username": "jan", "password": PASSWORD})
    assert r.status_code == 423
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "jan"))
        assert user.locked_until is not None


def test_lock_expires(client, make_user):
    make_user("jan")
    with SessionLocal() as db:
        db.execute(update(User).values(locked_until=datetime.now(UTC) - timedelta(seconds=1)))
        db.commit()
    login(client, "jan")


def test_inactive_user_cannot_login(client, make_user):
    make_user("jan", is_active=False)
    r = client.post("/api/auth/login", json={"username": "jan", "password": PASSWORD})
    assert r.status_code == 401


def test_csrf_required_for_unsafe_methods(client, make_user):
    make_user("jan")
    login(client, "jan")
    del client.headers["X-CSRF-Token"]
    assert client.post("/api/auth/logout").status_code == 403
    client.headers["X-CSRF-Token"] = "falszywy"
    assert client.post("/api/auth/logout").status_code == 403


def test_logout_revokes_session(client, make_user):
    make_user("jan")
    login(client, "jan")
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_idle_timeout(client, make_user):
    make_user("jan")
    login(client, "jan")
    with SessionLocal() as db:
        db.execute(update(UserSession).values(last_seen_at=datetime.now(UTC) - timedelta(minutes=31)))
        db.commit()
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert "bezczynności" in r.json()["detail"]
    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.action == "session_expired")).one()
        assert log.username == "jan" and log.details == {"reason": "idle"}
    # kolejne żądania z tą sesją nie dopisują już wpisów
    client.get("/api/auth/me")
    with SessionLocal() as db:
        assert len(list(db.scalars(select(AuditLog).where(AuditLog.action == "session_expired")))) == 1


def test_logout_reason_idle(client, make_user):
    make_user("jan")
    login(client, "jan")
    assert client.post("/api/auth/logout?reason=idle").status_code == 204
    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.action == "logout")).one()
        assert log.details == {"reason": "idle"}


def test_must_change_password_blocks_other_endpoints(client, make_user):
    make_user("jan", Role.admin, must_change_password=True)
    body = login(client, "jan")
    assert body["user"]["must_change_password"] is True
    r = client.get("/api/users")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "password_change_required"
    # /me nadal działa
    assert client.get("/api/auth/me").status_code == 200


def test_change_password_flow(client, make_user):
    make_user("jan", Role.admin, must_change_password=True)
    login(client, "jan")

    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "zle", "new_password": "Nowe-Haslo-456789"},
    )
    assert r.status_code == 400

    r = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "krotkie"},
    )
    assert r.status_code == 400

    r = client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "Nowe-Haslo-456789"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["must_change_password"] is False
    assert client.get("/api/users").status_code == 200

    client.post("/api/auth/logout")
    login(client, "jan", "Nowe-Haslo-456789")


def test_change_password_revokes_other_sessions(make_user):
    from fastapi.testclient import TestClient

    from app.main import app

    make_user("jan")
    a, b = TestClient(app), TestClient(app)
    login(a, "jan")
    login(b, "jan")
    r = a.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "Nowe-Haslo-456789"},
    )
    assert r.status_code == 200
    assert a.get("/api/auth/me").status_code == 200
    assert b.get("/api/auth/me").status_code == 401


def test_audit_log_is_append_only(client, make_user):
    make_user("jan")
    login(client, "jan")
    import pytest
    from sqlalchemy.exc import DBAPIError

    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("UPDATE audit_log SET action = 'x'"))
    with pytest.raises(DBAPIError):
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM audit_log"))
