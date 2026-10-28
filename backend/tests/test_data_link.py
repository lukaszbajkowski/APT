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


def _set_contact(c, kind, value):  # noqa: ANN001
    """Zapis kontaktu przez „Moje dane” (start + kod z poczty / SMS)."""
    r = c.post(f"/api/me/contact/{kind}/start", json={"value": value})
    if r.status_code != 200:
        return r
    text = mailer.outbox[-1][2] if kind == "email" else sms.outbox[-1][1]
    code = re.search(r"\b(\d{6})\b", text).group(1)
    return c.post(f"/api/me/contact/{kind}/confirm", json={"code": code})


def test_contact_unique_and_staff_can_remove(hr, emp):  # noqa: F811
    from app.db import SessionLocal
    from app.models import Employee

    with SessionLocal() as db:
        e2 = Employee(first_name="Jan", last_name="Kowalski", birth_date=BORN)
        db.add(e2)
        db.commit()
        e2_id = e2.id
    mailer.outbox, sms.outbox = [], []
    a, b = TestClient(app), TestClient(app)
    for c, eid in ((a, emp), (b, e2_id)):
        r = _activate(c, _invite(hr, eid), FakeAuthenticator())
        assert r.status_code == 200, r.text
        c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert _set_contact(a, "email", "wspolny@example.com").status_code == 200
    assert _set_contact(a, "phone", "600100200").status_code == 200
    # ten sam kontakt (także w innej pisowni) nie trafi do drugiego pracownika
    assert _set_contact(b, "email", "Wspolny@Example.com").status_code == 409
    assert _set_contact(b, "phone", "+48 600 100 200").status_code == 409
    assert _set_contact(b, "email", "inny@example.com").status_code == 200
    # ten sam pracownik może zapisać własny kontakt ponownie
    assert _set_contact(a, "email", "wspolny@example.com").status_code == 200

    # kadry usuwają kontakt – wtedy adres jest wolny
    assert hr.delete(f"/api/employees/{emp}/contact/email").status_code == 204
    assert hr.delete(f"/api/employees/{emp}/contact/phone").status_code == 204
    d = hr.get(f"/api/employees/{emp}").json()
    assert not d.get("contact_email") and not d.get("contact_phone")
    assert _set_contact(b, "phone", "600100200").status_code == 200


def test_manager_cannot_remove_contact(client, make_user, emp):  # noqa: F811
    from app.models import Role
    from tests.conftest import login

    make_user("kier2", Role.manager)
    login(client, "kier2")
    assert client.delete(f"/api/employees/{emp}/contact/email").status_code == 403


def test_link_works_only_15_minutes_after_first_use(hr, emp):  # noqa: F811
    from datetime import timedelta

    from app.db import SessionLocal
    from app.deps import utcnow
    from app.models import DataLink

    token = _token(hr, emp)
    pub = TestClient(app)
    h = _verify(pub, token)
    assert pub.get(f"/api/data-link/{token}/data", headers=h).status_code == 200
    # ponowne wejście w tym oknie jest możliwe, ale nie wydłuża go
    _verify(pub, token)
    with SessionLocal() as db:
        link = db.query(DataLink).filter(DataLink.employee_id == emp).one()
        first = link.first_used_at
        link.first_used_at = utcnow() - timedelta(minutes=16)
        db.commit()
    assert first is not None
    r = pub.get(f"/api/data-link/{token}/data", headers=h)
    assert r.status_code == 410 and "wykorzystany" in r.json()["detail"]
    assert (
        pub.post(f"/api/data-link/{token}/verify", json={"birth_date": BORN.isoformat()}).status_code == 410
    )
    assert hr.get(f"/api/employees/{emp}/data-link").json()["active"] is False
