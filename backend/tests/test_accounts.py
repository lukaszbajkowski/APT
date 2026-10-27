"""Konta pracowników: zaproszenie, klucze dostępu (WebAuthn), ograniczenie dostępu do własnego rekordu."""

import hashlib
import json
import os
from datetime import date
from urllib.parse import urlparse

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from app import mailer
from app.config import get_settings
from app.db import SessionLocal
from app.device import _b64
from app.models import Employee, Role, User
from tests.conftest import PASSWORD, login

BORN = date(1990, 5, 17)


class FakeAuthenticator:
    """Programowy „telefon”: tworzy klucz EC i podpisuje wyzwania jak przeglądarka z Face ID."""

    def __init__(self) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.counter = 0
        pub = get_settings().public_url
        self.rp_id = urlparse(pub).hostname
        self.origin = pub.rstrip("/")

    def _client(self, typ: str, challenge: str) -> bytes:
        return json.dumps({"type": typ, "challenge": challenge, "origin": self.origin}).encode()

    def create(self, options: dict, *, uv: bool = True) -> dict:
        nums = self.key.public_key().public_numbers()
        cose = cbor2.dumps(
            {1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")}
        )
        auth = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([0x45 if uv else 0x41])
            + (0).to_bytes(4, "big")
            + bytes(16)
            + len(self.cred_id).to_bytes(2, "big")
            + self.cred_id
            + cose
        )
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})
        cid = _b64(self.cred_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(self._client("webauthn.create", options["challenge"])),
                "attestationObject": _b64(att),
            },
        }

    def get(self, options: dict, *, uv: bool = True) -> dict:
        self.counter += 1
        auth = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([0x05 if uv else 0x01])
            + self.counter.to_bytes(4, "big")
        )
        client = self._client("webauthn.get", options["challenge"])
        sig = self.key.sign(auth + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        cid = _b64(self.cred_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(client),
                "authenticatorData": _b64(auth),
                "signature": _b64(sig),
                "userHandle": None,
            },
        }


@pytest.fixture
def hr(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    return client


@pytest.fixture
def emp() -> int:
    with SessionLocal() as db:
        e = Employee(first_name="Anna", last_name="Nowak", birth_date=BORN)
        db.add(e)
        db.commit()
        return e.id


def _invite(hr, emp_id, email="anna@example.com") -> str:
    mailer.outbox = []
    r = hr.post(f"/api/employees/{emp_id}/account/invite", json={"email": email})
    assert r.status_code == 200, r.text
    return r.json()["link"].split("token=")[1]


def _activate(client, token, auth: FakeAuthenticator):
    r = client.post("/api/auth/invite/options", json={"token": token, "birth_date": BORN.isoformat()})
    assert r.status_code == 200, r.text
    body = r.json()
    return client.post(
        "/api/auth/invite/passkey",
        json={
            "token": token,
            "birth_date": BORN.isoformat(),
            "challenge_id": body["challenge_id"],
            "credential": auth.create(body["options"]),
        },
    )


def test_invite_creates_account_and_sends_mail(hr, emp):
    mailer.outbox = []
    r = hr.post(f"/api/employees/{emp}/account/invite", json={"email": "anna@example.com"})
    assert r.status_code == 200
    out = r.json()
    assert out["sent"] is True
    assert out["account"]["exists"] and out["account"]["invite_pending"]
    assert out["account"]["username"].startswith("pr")
    assert "/zaproszenie?token=" in out["link"]
    assert mailer.outbox and mailer.outbox[0][0] == "anna@example.com"
    assert hr.get(f"/api/employees/{emp}/account").json()["exists"] is True


def test_only_staff_can_invite(client, make_user, emp):
    make_user("kier", Role.manager)
    login(client, "kier")
    assert client.post(f"/api/employees/{emp}/account/invite", json={}).status_code == 403


def test_activation_with_passkey_and_login(hr, client, emp):
    token = _invite(hr, emp)
    from fastapi.testclient import TestClient

    from app.main import app

    phone = TestClient(app)
    auth = FakeAuthenticator()
    info = phone.get(f"/api/auth/invite/{token}")
    assert info.status_code == 200 and info.json()["needs_birth_date"] is True
    r = _activate(phone, token, auth)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "employee"
    # zaproszenie jest jednorazowe
    assert phone.get(f"/api/auth/invite/{token}").status_code == 410

    # logowanie bez hasła kluczem dostępu
    other = TestClient(app)
    o = other.post("/api/auth/passkey/options").json()
    r = other.post(
        "/api/auth/passkey/login",
        json={"challenge_id": o["challenge_id"], "credential": auth.get(o["options"])},
    )
    assert r.status_code == 200, r.text
    other.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    me = other.get("/api/me/employee")
    assert me.status_code == 200 and me.json()["first_name"] == "Anna"
    assert me.json()["has_passkey"] is True


def test_wrong_birth_date_rejected(hr, emp):
    token = _invite(hr, emp)
    r = hr.post("/api/auth/invite/options", json={"token": token, "birth_date": "1991-01-01"})
    assert r.status_code == 403


def test_replayed_or_unverified_assertion_rejected(hr, emp):
    from fastapi.testclient import TestClient

    from app.main import app

    token = _invite(hr, emp)
    phone = TestClient(app)
    auth = FakeAuthenticator()
    assert _activate(phone, token, auth).status_code == 200

    c = TestClient(app)
    o = c.post("/api/auth/passkey/options").json()
    cred = auth.get(o["options"])
    ok = c.post("/api/auth/passkey/login", json={"challenge_id": o["challenge_id"], "credential": cred})
    assert ok.status_code == 200
    # to samo wyzwanie drugi raz – odrzucone (jednorazowe)
    again = c.post("/api/auth/passkey/login", json={"challenge_id": o["challenge_id"], "credential": cred})
    assert again.status_code == 400
    # bez weryfikacji użytkownika (UV) – odrzucone
    o2 = c.post("/api/auth/passkey/options").json()
    bad = c.post(
        "/api/auth/passkey/login",
        json={"challenge_id": o2["challenge_id"], "credential": auth.get(o2["options"], uv=False)},
    )
    assert bad.status_code == 401
    # inny klucz – odrzucony
    o3 = c.post("/api/auth/passkey/options").json()
    bad = c.post(
        "/api/auth/passkey/login",
        json={"challenge_id": o3["challenge_id"], "credential": FakeAuthenticator().get(o3["options"])},
    )
    assert bad.status_code == 401


def test_employee_session_limited_to_own_paths(hr, emp):
    from fastapi.testclient import TestClient

    from app.main import app

    token = _invite(hr, emp)
    phone = TestClient(app)
    r = _activate(phone, token, FakeAuthenticator())
    phone.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert phone.get("/api/employees").status_code == 403
    assert phone.get(f"/api/employees/{emp}").status_code == 403
    assert phone.get("/api/users").status_code == 403
    assert phone.get("/api/auth/me").status_code == 200


def test_password_fallback_requires_totp(hr, emp):
    from fastapi.testclient import TestClient

    from app.main import app

    token = _invite(hr, emp)
    get_settings().mfa_enforce = True
    try:
        phone = TestClient(app)
        r = phone.post(
            "/api/auth/invite/password",
            json={"token": token, "birth_date": BORN.isoformat(), "password": PASSWORD},
        )
        assert r.status_code == 200, r.text
        assert r.json()["mfa_setup_required"] is True
        phone.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        assert phone.get("/api/me/employee").status_code == 403  # najpierw kod z aplikacji
    finally:
        get_settings().mfa_enforce = False


def test_disable_account_blocks_login_and_sessions(hr, emp):
    from fastapi.testclient import TestClient

    from app.main import app

    token = _invite(hr, emp)
    phone = TestClient(app)
    auth = FakeAuthenticator()
    r = _activate(phone, token, auth)
    phone.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert hr.post(f"/api/employees/{emp}/account/active", json={"active": False}).status_code == 200
    assert phone.get("/api/auth/me").status_code == 401
    o = phone.post("/api/auth/passkey/options").json()
    r = phone.post(
        "/api/auth/passkey/login",
        json={"challenge_id": o["challenge_id"], "credential": auth.get(o["options"])},
    )
    assert r.status_code == 401


def test_cannot_remove_last_passkey_without_password(hr, emp):
    from fastapi.testclient import TestClient

    from app.main import app

    token = _invite(hr, emp)
    phone = TestClient(app)
    r = _activate(phone, token, FakeAuthenticator())
    phone.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    keys = phone.get("/api/passkeys").json()
    assert len(keys) == 1
    assert phone.delete(f"/api/passkeys/{keys[0]['id']}").status_code == 400


def test_active_account_cannot_be_invited_or_reactivated(hr, emp):
    from fastapi.testclient import TestClient

    from app.main import app

    token = _invite(hr, emp)
    other_token = _invite(hr, emp)  # nowe zaproszenie unieważnia poprzednie
    assert token != other_token
    phone = TestClient(app)
    assert _activate(phone, other_token, FakeAuthenticator()).status_code == 200
    # konto aktywne: nowe zaproszenie zablokowane
    r = hr.post(f"/api/employees/{emp}/account/invite", json={})
    assert r.status_code == 409
    # po resecie dostępu można zaprosić ponownie, a stary klucz przestaje działać
    mailer.outbox = []
    assert hr.post(f"/api/employees/{emp}/account/reset", json={"email": "a@example.com"}).status_code == 200
    assert mailer.outbox and mailer.outbox[0][0] == "a@example.com"
    assert hr.get(f"/api/employees/{emp}/account").json()["has_passkey"] is False
    assert hr.post(f"/api/employees/{emp}/account/invite", json={}).status_code == 200


def test_users_screen_cannot_create_employee(admin_client):
    r = admin_client.post(
        "/api/users",
        json={"username": "xx", "full_name": "X Y", "role": "employee", "password": PASSWORD},
    )
    assert r.status_code in (400, 422)
    assert User  # import używany


def test_admin_must_reconfirm_before_adding_passkey(admin_client):
    r = admin_client.post("/api/passkeys/options", json={})
    assert r.status_code == 400
    r = admin_client.post("/api/passkeys/options", json={"password": "zle"})
    assert r.status_code == 400
    r = admin_client.post("/api/passkeys/options", json={"password": PASSWORD})
    assert r.status_code == 200
    # po dodaniu klucza wysyłamy powiadomienie e-mail
    mailer.outbox = []
    opts = r.json()
    auth = FakeAuthenticator()
    r = admin_client.post(
        "/api/passkeys",
        json={"challenge_id": opts["challenge_id"], "credential": auth.create(opts["options"])},
    )
    assert r.status_code == 201


def test_accounts_list_for_staff(hr, emp):
    assert hr.get("/api/employee-accounts").json() == []
    _invite(hr, emp)
    rows = hr.get("/api/employee-accounts").json()
    assert len(rows) == 1 and rows[0]["status"] == "pending" and rows[0]["invite_pending"] is True
    assert rows[0]["name"] == "Nowak Anna"
    assert hr.get("/api/employee-accounts", params={"q": "nowak"}).json()
    assert hr.get("/api/employee-accounts", params={"q": "xyz"}).json() == []
    assert hr.get("/api/employee-accounts", params={"status_filter": "active"}).json() == []
    hr.post(f"/api/employees/{emp}/account/active", json={"active": False})
    assert hr.get("/api/employee-accounts", params={"status_filter": "disabled"}).json()


def test_accounts_list_forbidden_for_manager(client, make_user):
    make_user("kier2", Role.manager)
    login(client, "kier2")
    assert client.get("/api/employee-accounts").status_code == 403
