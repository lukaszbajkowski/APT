"""Etap D: podpis w koncie pracownika (lista „Do podpisu”, klucz dostępu, wyjątek z linkiem)."""

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import mailer, sms
from app.db import SessionLocal
from app.main import app
from app.models import AuditLog
from app.templating import soffice_path
from tests.test_accounts import FakeAuthenticator
from tests.test_signatures import BORN, _doc, _sig_png

pytestmark = pytest.mark.skipif(soffice_path() is None, reason="brak LibreOffice")


def _activate(client, token, auth):
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


def _account(admin_client):
    e, doc = _doc(admin_client)
    r = admin_client.post(f"/api/employees/{e['id']}/account/invite", json={"email": "ola@example.com"})
    assert r.status_code == 200, r.text
    token = r.json()["link"].split("token=")[1]
    auth = FakeAuthenticator()
    c = TestClient(app)
    r = _activate(c, token, auth)
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return e, doc, auth, c


def _confirm_email(c, value="ola@example.com"):
    c.post("/api/me/contact/email/start", json={"value": value})
    code = re.search(r"\b(\d{6})\b", mailer.outbox[-1][2]).group(1)
    assert c.post("/api/me/contact/email/confirm", json={"code": code}).status_code == 200


def test_sign_in_account_with_passkey(admin_client):
    mailer.outbox, sms.outbox = [], []
    e, doc, auth, c = _account(admin_client)
    _confirm_email(c)
    mailer.outbox = []
    r = admin_client.post(
        f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika", "channel": "link"}
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["in_account"] is True and out["notified"] == "e-mail" and out["expires_at"] is None
    assert "/podpis/" not in out["link"]
    assert mailer.outbox and "Nowy dokument do podpisu" in mailer.outbox[0][1]
    # stan dla kadr: pracownik ma konto
    roles = admin_client.get(f"/api/documents/{doc['id']}/signatures").json()["roles"]
    assert roles[0]["status"] == "pending" and roles[0]["channel"] == "konto" and roles[0]["employee_account"]

    lst = c.get("/api/me/signatures").json()
    assert len(lst["pending"]) == 1 and c.get("/api/me/signatures/count").json() == {"pending": 1}
    sid = lst["pending"][0]["id"]
    assert c.get(f"/api/me/signatures/{sid}").json()["pages"] >= 1
    assert c.get(f"/api/me/signatures/{sid}/page/0").status_code == 200

    ch = c.post(f"/api/me/signatures/{sid}/challenge").json()
    body = {"image": _sig_png(), "consent": True, "challenge_id": ch["challenge_id"]}
    # bez zgody i z cudzą odpowiedzią – odmowa
    assert (
        c.post(
            f"/api/me/signatures/{sid}/sign",
            json=body | {"consent": False, "credential": auth.get(ch["options"])},
        ).status_code
        == 400
    )
    ch = c.post(f"/api/me/signatures/{sid}/challenge").json()
    other = FakeAuthenticator()
    bad = {
        "image": _sig_png(),
        "consent": True,
        "challenge_id": ch["challenge_id"],
        "credential": other.get(ch["options"]),
    }
    assert c.post(f"/api/me/signatures/{sid}/sign", json=bad).status_code == 400
    ch = c.post(f"/api/me/signatures/{sid}/challenge").json()
    good = {
        "image": _sig_png(),
        "consent": True,
        "challenge_id": ch["challenge_id"],
        "credential": auth.get(ch["options"]),
    }
    assert c.post(f"/api/me/signatures/{sid}/sign", json=good).status_code == 200
    # wyzwanie jest jednorazowe, podpis nie powtórzy się
    assert c.post(f"/api/me/signatures/{sid}/sign", json=good).status_code in (400, 409)

    assert c.get("/api/me/signatures").json()["pending"] == []
    assert len(c.get("/api/me/signatures").json()["signed"]) == 1
    roles = admin_client.get(f"/api/documents/{doc['id']}/signatures").json()["roles"]
    assert roles[0]["status"] == "signed" and roles[0]["device_verified"] is True


def test_staff_can_force_link_despite_account(admin_client):
    e, doc, auth, c = _account(admin_client)
    r = admin_client.post(
        f"/api/documents/{doc['id']}/signatures",
        json={"role": "pracownika", "channel": "link", "force_link": True},
    )
    assert r.status_code == 201, r.text
    assert r.json()["in_account"] is False and "/podpis/" in r.json()["link"]
    assert c.get("/api/me/signatures").json()["pending"] == []  # nie ma go na liście w koncie
    with SessionLocal() as db:
        n = db.scalar(select(AuditLog).where(AuditLog.action == "signature_link_despite_account"))
        assert n is not None


def test_company_role_still_uses_link_and_others_cannot_sign(admin_client):
    e, doc, auth, c = _account(admin_client)
    r = admin_client.post(f"/api/documents/{doc['id']}/signatures", json={"role": "firmy", "channel": "link"})
    assert r.status_code == 201 and r.json()["in_account"] is False
    r = admin_client.post(
        f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika", "channel": "link"}
    )
    sid = c.get("/api/me/signatures").json()["pending"][0]["id"]
    anon = TestClient(app)
    assert anon.get(f"/api/me/signatures/{sid}").status_code == 401
    assert admin_client.get(f"/api/me/signatures/{sid}").status_code == 403
