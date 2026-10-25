import time
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import totp
from app.config import get_settings
from app.crypto import decrypt_secret
from app.db import SessionLocal
from app.models import AuditLog, Role, User
from tests.conftest import PASSWORD, login


@pytest.fixture(autouse=True)
def _enforce() -> Iterator[None]:
    settings = get_settings()
    settings.mfa_enforce = True
    yield
    settings.mfa_enforce = False


def _secret(username: str) -> bytes:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is not None and user.totp_secret_enc is not None
        return decrypt_secret(user.totp_secret_enc)


def _code(secret: bytes, offset: int = 0) -> str:
    return totp.code_at(secret, totp.current_step() + offset)


def _enable(client: TestClient, username: str) -> tuple[bytes, list[str]]:
    r = client.post("/api/auth/mfa/setup")
    assert r.status_code == 200, r.text
    assert r.json()["otpauth_uri"].startswith("otpauth://totp/")
    assert r.json()["qr_svg"].startswith("<svg")
    secret = _secret(username)
    r = client.post("/api/auth/mfa/enable", json={"code": _code(secret)})
    assert r.status_code == 200, r.text
    codes = r.json()["recovery_codes"]
    assert len(codes) == 10
    assert r.json()["me"]["mfa_setup_required"] is False
    return secret, codes


def _actions() -> list[str]:
    with SessionLocal() as db:
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))


def test_rfc6238_vector() -> None:
    secret = b"12345678901234567890"
    assert totp.code_at(secret, 59 // 30) == "287082"
    assert totp.code_at(secret, 1111111109 // 30) == "081804"


def test_admin_must_set_up_mfa(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    body = login(client, "admin")
    assert body["mfa_setup_required"] is True
    r = client.get("/api/employees")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "mfa_setup_required"
    # /me i konfiguracja 2FA są dostępne
    assert client.get("/api/auth/me").status_code == 200
    _enable(client, "admin")
    assert client.get("/api/employees").status_code == 200
    assert "mfa_enabled" in _actions()


def test_manager_mfa_optional(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("kier", Role.manager)
    body = login(client, "kier")
    assert body["mfa_setup_required"] is False
    assert client.get("/api/employees").status_code == 200
    _enable(client, "kier")
    r = client.post("/api/auth/mfa/disable", json={"password": "zle"})
    assert r.status_code == 400
    r = client.post("/api/auth/mfa/disable", json={"password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["user"]["mfa_enabled"] is False


def test_hr_cannot_disable(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("kadry", Role.hr)
    login(client, "kadry")
    _enable(client, "kadry")
    r = client.post("/api/auth/mfa/disable", json={"password": PASSWORD})
    assert r.status_code == 403


def test_login_requires_code(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    login(client, "admin")
    secret, codes = _enable(client, "admin")
    client.post("/api/auth/logout")
    client.cookies.clear()

    body = login(client, "admin")
    assert body["mfa_pending"] is True
    # bez kodu nic nie działa
    assert client.get("/api/employees").status_code == 401
    assert (
        client.post(
            "/api/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "Inne-Haslo-12345"},
        ).status_code
        == 401
    )
    assert client.get("/api/auth/me").json()["mfa_pending"] is True

    r = client.post(
        "/api/auth/mfa/verify", json={"code": "000000" if _code(secret) != "000000" else "111111"}
    )
    assert r.status_code == 400
    r = client.post("/api/auth/mfa/verify", json={"code": _code(secret, 1)})
    assert r.status_code == 200, r.text
    assert r.json()["mfa_pending"] is False
    assert client.get("/api/employees").status_code == 200
    assert "mfa_failed" in _actions()


def test_code_cannot_be_reused(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    login(client, "admin")
    secret, _ = _enable(client, "admin")  # użył kodu z bieżącego okna
    client.cookies.clear()
    login(client, "admin")
    r = client.post("/api/auth/mfa/verify", json={"code": _code(secret)})
    assert r.status_code == 400


def test_recovery_code_single_use(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    login(client, "admin")
    _, codes = _enable(client, "admin")
    for expected in (200, 400):
        client.cookies.clear()
        login(client, "admin")
        r = client.post("/api/auth/mfa/verify", json={"code": codes[0].lower()})
        assert r.status_code == expected, r.text
    assert "mfa_recovery_used" in _actions()


def test_too_many_wrong_codes_lock(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    login(client, "admin")
    secret, _ = _enable(client, "admin")
    client.cookies.clear()
    login(client, "admin")
    wrong = "123456" if _code(secret) != "123456" else "654321"
    statuses = [client.post("/api/auth/mfa/verify", json={"code": wrong}).status_code for _ in range(5)]
    assert statuses[-1] == 423
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "admin"))
        assert user is not None and user.locked_until is not None


def test_pending_session_expires_quickly(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    login(client, "admin")
    _enable(client, "admin")
    client.cookies.clear()
    login(client, "admin")
    from app.models import UserSession

    with SessionLocal() as db:
        sess = db.scalars(select(UserSession).where(UserSession.mfa_pending.is_(True))).one()
        assert (sess.expires_at - sess.created_at).total_seconds() < 15 * 60


def test_admin_resets_other_user(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    make_user("kadry", Role.hr)
    other = TestClient(client.app)
    login(other, "kadry")
    _enable(other, "kadry")

    login(client, "admin")
    _enable(client, "admin")
    with SessionLocal() as db:
        kadry_id = db.scalar(select(User.id).where(User.username == "kadry"))
        admin_id = db.scalar(select(User.id).where(User.username == "admin"))
    r = client.post(f"/api/users/{admin_id}/mfa-reset")
    assert r.status_code == 400
    r = client.post(f"/api/users/{kadry_id}/mfa-reset")
    assert r.status_code == 200
    assert r.json()["mfa_enabled"] is False
    # sesje użytkownika zostały wylogowane
    assert other.get("/api/auth/me").status_code == 401


def test_new_recovery_codes(client: TestClient, make_user: Callable[..., User]) -> None:
    make_user("admin", Role.admin)
    login(client, "admin")
    secret, old = _enable(client, "admin")
    r = client.post("/api/auth/mfa/recovery-codes", json={"code": _code(secret, 1)})
    assert r.status_code == 200, r.text
    new = r.json()["recovery_codes"]
    assert set(new).isdisjoint(old)
    client.cookies.clear()
    login(client, "admin")
    assert client.post("/api/auth/mfa/verify", json={"code": old[0]}).status_code == 400


def test_cli_reset(make_user: Callable[..., User], client: TestClient) -> None:
    from app.cli import main

    make_user("admin", Role.admin)
    login(client, "admin")
    _enable(client, "admin")
    assert main(["reset-mfa", "--username", "admin"]) == 0
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "admin"))
        assert user is not None and not user.mfa_enabled


def test_clock_skew_window() -> None:
    secret = totp.new_secret()
    now = time.time()
    prev = totp.code_at(secret, totp.current_step(now) - 1)
    assert totp.verify(secret, prev, None, now) is not None
    far = totp.code_at(secret, totp.current_step(now) - 3)
    assert totp.verify(secret, far, None, now) is None
