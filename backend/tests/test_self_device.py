"""„Dodaj inne urządzenie”: użytkownik sam tworzy jednorazowy link (10 min) po świeżym potwierdzeniu tożsamości."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.deps import utcnow
from app.main import app
from app.models import AuditLog, PasswordToken, User, WebauthnCredential
from tests.conftest import PASSWORD
from tests.test_accounts import FakeAuthenticator, _activate, _invite, _login_with, emp, hr  # noqa: F401


def _token(link: str) -> str:
    return link.split("token=")[1]


def _open_and_register(token: str, auth: FakeAuthenticator) -> tuple[TestClient, object]:
    dev = TestClient(app)
    info = dev.get(f"/api/auth/invite/{token}")
    assert info.status_code == 200, info.text
    assert info.json()["add_device"] is True and info.json()["needs_birth_date"] is False
    o = dev.post("/api/auth/invite/options", json={"token": token}).json()
    r = dev.post(
        "/api/auth/invite/passkey",
        json={"token": token, "challenge_id": o["challenge_id"], "credential": auth.create(o["options"])},
    )
    return dev, r


def test_employee_creates_link_with_passkey(hr, emp):  # noqa: F811
    phone, laptop = FakeAuthenticator(), FakeAuthenticator()
    c = TestClient(app)
    r = _activate(c, _invite(hr, emp), phone)
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    # bez potwierdzenia – nie; hasło nie dotyczy konta pracownika
    assert c.post("/api/passkeys/device-link", json={}).status_code == 400
    assert c.post("/api/passkeys/device-link", json={"password": "x"}).status_code == 400
    o = c.post("/api/passkeys/device-link/options").json()
    r = c.post("/api/passkeys/device-link", json={"challenge_id": o["challenge_id"], "credential": phone.get(o["options"])})
    assert r.status_code == 200, r.text
    out = r.json()
    assert "<svg" in out["qr_svg"] and "/zaproszenie?token=" in out["link"]
    # nowy link unieważnia poprzedni
    o = c.post("/api/passkeys/device-link/options").json()
    link2 = c.post("/api/passkeys/device-link", json={"challenge_id": o["challenge_id"], "credential": phone.get(o["options"])}).json()["link"]
    assert TestClient(app).get(f"/api/auth/invite/{_token(out['link'])}").status_code == 410
    _, r = _open_and_register(_token(link2), laptop)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "employee"
    # jednorazowy; oba urządzenia logują się
    assert TestClient(app).get(f"/api/auth/invite/{_token(link2)}").status_code == 410
    assert _login_with(phone).status_code == 200 and _login_with(laptop).status_code == 200
    with SessionLocal() as db:
        uid = db.scalar(select(User.id).where(User.employee_id == emp))
        assert db.scalar(select(func.count()).select_from(WebauthnCredential).where(WebauthnCredential.user_id == uid)) == 2
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "device_added")) == 1


def test_staff_creates_link_with_password_and_link_expires(admin_client):
    c = admin_client
    # bez klucza nie ma wyzwania do potwierdzenia kluczem – ale hasło działa
    assert c.post("/api/passkeys/device-link/options").status_code == 400
    assert c.post("/api/passkeys/device-link", json={"password": "zle"}).status_code == 400
    r = c.post("/api/passkeys/device-link", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    token = _token(r.json()["link"])
    dev, r = _open_and_register(token, FakeAuthenticator())
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "admin"
    # wygasa po 10 minutach
    token = _token(c.post("/api/passkeys/device-link", json={"password": PASSWORD}).json()["link"])
    with SessionLocal() as db:
        t = db.scalar(select(PasswordToken).where(PasswordToken.purpose == "selfdevice", PasswordToken.used_at.is_(None)))
        assert t.expires_at - utcnow() <= timedelta(minutes=10)
        t.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert TestClient(app).get(f"/api/auth/invite/{token}").status_code == 410


def test_self_link_is_not_a_password_reset_link(admin_client):
    token = _token(admin_client.post("/api/passkeys/device-link", json={"password": PASSWORD}).json()["link"])
    c = TestClient(app)
    assert c.get("/api/auth/password-reset/check", params={"token": token}).json()["valid"] is False
    assert c.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": PASSWORD}).status_code == 400
