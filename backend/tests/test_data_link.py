"""Etap C: aktualizacja danych bez konta – link od kadr, data urodzenia, kontakt z kodem, zdjęcie."""

import io
import re

from fastapi.testclient import TestClient
from PIL import Image

from app import mailer, sms
from app.main import app
from tests.test_accounts import BORN, FakeAuthenticator, _activate, _invite, emp, hr  # noqa: F401, F811


def _token(hr_client, emp_id, **body) -> str:  # noqa: ANN001
    mailer.outbox, sms.outbox = [], []
    r = hr_client.post(f"/api/employees/{emp_id}/data-link", json=body)
    assert r.status_code == 200, r.text
    return r.json()["link"].split("token=")[1]


def _verify(c, token) -> dict:  # noqa: ANN001
    r = c.post(f"/api/data-link/{token}/verify", json={"birth_date": BORN.isoformat()})
    assert r.status_code == 200, r.text
    return {"X-Link-Access": r.json()["access"]}


def test_link_flow_contact_and_photo(hr, emp):  # noqa: F811
    token = _token(hr, emp, email="anna@example.com")
    assert mailer.outbox and "/aktualizacja?token=" in mailer.outbox[0][2]
    pub = TestClient(app)
    assert pub.get(f"/api/data-link/{token}").json()["first_name"] == "Anna"
    assert pub.get(f"/api/data-link/{token}/data").status_code == 403  # bez daty urodzenia
    h = _verify(pub, token)
    assert pub.get(f"/api/data-link/{token}/data", headers=h).json()["email"] is None

    start = f"/api/data-link/{token}/contact/email/start"
    assert pub.post(start, json={"value": "nowy@example.com"}).status_code == 403  # bez dostępu
    assert pub.post(start, json={"value": "nowy@example.com"}, headers=h).status_code == 200
    code = re.search(r"\b(\d{6})\b", mailer.outbox[-1][2]).group(1)
    r = pub.post(f"/api/data-link/{token}/contact/email/confirm", json={"code": code}, headers=h)
    assert r.status_code == 200 and r.json()["email"].endswith("@example.com") and r.json()["email_verified"]
    assert "nowy" not in r.json()["email"]  # zamaskowany
    assert hr.get(f"/api/employees/{emp}").json()["contact_email"] == "nowy@example.com"

    buf = io.BytesIO()
    Image.new("RGB", (400, 500), "gray").save(buf, "JPEG")
    r = pub.put(
        f"/api/data-link/{token}/photo", files={"file": ("a.jpg", buf.getvalue(), "image/jpeg")}, headers=h
    )
    assert r.status_code == 200 and r.json()["has_photo"]
    assert pub.get(f"/api/data-link/{token}/photo?k={h['X-Link-Access']}").status_code == 200
    assert pub.get(f"/api/data-link/{token}/photo").status_code == 403


def test_wrong_birth_date_locks_link(hr, emp):  # noqa: F811
    token = _token(hr, emp)
    pub = TestClient(app)
    for _ in range(4):
        assert (
            pub.post(f"/api/data-link/{token}/verify", json={"birth_date": "2000-01-01"}).status_code == 403
        )
    assert pub.post(f"/api/data-link/{token}/verify", json={"birth_date": "2000-01-01"}).status_code == 410
    assert pub.get(f"/api/data-link/{token}").status_code == 404


def test_new_link_cancels_old_and_staff_can_cancel(hr, emp):  # noqa: F811
    t1 = _token(hr, emp)
    t2 = _token(hr, emp)
    pub = TestClient(app)
    assert pub.get(f"/api/data-link/{t1}").status_code == 404
    assert pub.get(f"/api/data-link/{t2}").status_code == 200
    assert hr.get(f"/api/employees/{emp}/data-link").json()["active"] is True
    assert hr.delete(f"/api/employees/{emp}/data-link").json()["active"] is False
    assert pub.get(f"/api/data-link/{t2}").status_code == 404


def test_not_for_active_account_or_missing_birth_date(hr, emp):  # noqa: F811
    from app.db import SessionLocal
    from app.models import Employee

    with SessionLocal() as db:
        e2 = Employee(first_name="Brak", last_name="Daty")
        db.add(e2)
        db.commit()
        e2_id = e2.id
    assert hr.post(f"/api/employees/{e2_id}/data-link", json={}).status_code == 409
    token = _invite(hr, emp)
    assert _activate(TestClient(app), token, FakeAuthenticator()).status_code == 200
    assert hr.post(f"/api/employees/{emp}/data-link", json={}).status_code == 409
    assert hr.get(f"/api/employees/{emp}/data-link").json()["account_active"] is True


def test_only_staff_creates_link(client, make_user, emp):  # noqa: F811
    from app.models import Role
    from tests.conftest import login

    make_user("kierownik", Role.manager)
    login(client, "kierownik")
    assert client.post(f"/api/employees/{emp}/data-link", json={}).status_code == 403
