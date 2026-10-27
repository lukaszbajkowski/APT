"""Etap B: „Moje dane” pracownika – dane, historia, zdjęcie, kontakt z potwierdzeniem kodem."""

import io
import re

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import mailer, sms
from app.main import app
from tests.test_accounts import BORN, FakeAuthenticator, _activate, _invite, emp, hr  # noqa: F401, F811


@pytest.fixture
def me(hr, emp):  # noqa: F811
    mailer.outbox, sms.outbox = [], []
    token = _invite(hr, emp)
    c = TestClient(app)
    r = _activate(c, token, FakeAuthenticator())
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    mailer.outbox, sms.outbox = [], []
    return c


def _code(text: str) -> str:
    return re.search(r"\b(\d{6})\b", text).group(1)


def test_my_data_and_history(me):
    d = me.get("/api/me/employee").json()
    assert d["first_name"] == "Anna" and d["birth_date"] == BORN.isoformat()
    assert d["phone"] is None and d["email"] is None
    h = me.get("/api/me/history")
    assert h.status_code == 200
    assert all(a["reason"] is None and a["changed_by"] is None for a in h.json()["assignments"])


def test_email_needs_code(me, hr, emp):  # noqa: F811
    r = me.post("/api/me/contact/email/start", json={"value": "Anna@Example.com"})
    assert r.status_code == 200 and r.json()["sent_to"].startswith("a***@")
    assert me.get("/api/me/employee").json()["email"] is None  # jeszcze niezapisany
    assert me.post("/api/me/contact/email/confirm", json={"code": "000000"}).status_code == 400
    code = _code(mailer.outbox[-1][2])
    r = me.post("/api/me/contact/email/confirm", json={"code": code})
    assert r.status_code == 200 and r.json()["email"] == "anna@example.com"
    assert r.json()["email_verified"] is True
    # kadry widzą kontakt, kod jest jednorazowy
    assert hr.get(f"/api/employees/{emp}").json()["contact_email"] == "anna@example.com"
    assert me.post("/api/me/contact/email/confirm", json={"code": code}).status_code == 400


def test_phone_code_and_attempt_limit(me):
    assert me.post("/api/me/contact/phone/start", json={"value": "abc"}).status_code == 400
    r = me.post("/api/me/contact/phone/start", json={"value": "600 100 200"})
    assert r.status_code == 200
    code = _code(sms.outbox[-1][1])
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert me.post("/api/me/contact/phone/confirm", json={"code": wrong}).status_code == 400
    assert me.post("/api/me/contact/phone/confirm", json={"code": code}).status_code == 400  # zablokowany
    me.post("/api/me/contact/phone/start", json={"value": "600100200"})
    code = _code(sms.outbox[-1][1])
    r = me.post("/api/me/contact/phone/confirm", json={"code": code})
    assert r.json()["phone"] == "48600100200"
    assert me.delete("/api/me/contact/phone").json()["phone"] is None


def test_send_rate_limit(me):
    for _ in range(5):
        assert me.post("/api/me/contact/email/start", json={"value": "a@b.pl"}).status_code == 200
    assert me.post("/api/me/contact/email/start", json={"value": "a@b.pl"}).status_code == 429


def test_photo_upload_and_serve(me):
    buf = io.BytesIO()
    Image.new("RGB", (400, 500), "gray").save(buf, "JPEG")
    r = me.put("/api/me/photo", files={"file": ("a.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["has_photo"] is True
    assert me.get("/api/me/photo").status_code == 200


def test_staff_cannot_use_me_endpoints(hr):  # noqa: F811
    assert hr.get("/api/me/employee").status_code == 403
