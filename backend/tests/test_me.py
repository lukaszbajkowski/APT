"""Etap B: „Moje dane” pracownika – dane, historia, zdjęcie, kontakt z potwierdzeniem kodem."""

import io
import re

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import mailer, sms
from app.main import app
from app.models import Role
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


def test_document_fields_prefilled_from_contact(me, hr, emp):  # noqa: F811
    from app import templating

    assert templating.contact_kind("E_mail_pracownika") == "email"
    assert templating.contact_kind("telefon") == "phone"
    assert templating.contact_kind("imie") is None
    me.post("/api/me/contact/email/start", json={"value": "anna@example.com"})
    me.post("/api/me/contact/email/confirm", json={"code": _code(mailer.outbox[-1][2])})
    from app.db import SessionLocal
    from app.models import Employee
    from app.routers.documents import _contact

    with SessionLocal() as db:
        e = db.get(Employee, emp)

        class U:
            role = Role.hr

        assert _contact(e, U()) == {"email": "anna@example.com"}
        U.role = Role.manager
        assert _contact(e, U()) == {}
        assert templating.builtin_values(e, None, contact={"email": "x@y.pl"})["email_pracownika"] == "x@y.pl"


def test_write_to_hr_thread(me, hr, emp):  # noqa: F811
    assert "Inne" in me.get("/api/me/messages/subjects").json()
    assert me.post("/api/me/messages", json={"subject": "xx", "body": "a"}).status_code == 400
    r = me.post("/api/me/messages", json={"subject": "Szkolenia", "body": "Kiedy kolejne szkolenie?"})
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert r.json()["employee_name"] is None  # pracownik nie dostaje danych kadrowych
    assert hr.get("/api/hr-messages/count").json()["new"] == 1
    row = hr.get("/api/hr-messages").json()[0]
    assert row["employee_name"] == "Nowak Anna" and row["status"] == "new"
    assert row["unread"] is True and hr.get("/api/hr-messages/count").json()["unread"] == 1
    assert me.get("/api/me/messages/count").json() == {"unread": 0}
    hr.get(f"/api/hr-messages/{tid}")  # otwarcie = przeczytane
    assert hr.get("/api/hr-messages/count").json()["unread"] == 0
    mailer.outbox = []
    r = hr.post(f"/api/hr-messages/{tid}/messages", json={"body": "W przyszłym tygodniu."})
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    assert me.get("/api/me/messages/count").json() == {"unread": 1}
    assert len(me.get(f"/api/me/messages/{tid}").json()["messages"]) == 3
    assert me.get("/api/me/messages/count").json() == {"unread": 0}
    r = hr.post(f"/api/hr-messages/{tid}/status", json={"status": "done"}).json()
    assert r["status"] == "done"
    ev = [m for m in r["messages"] if m["kind"] == "status"]
    assert [m["body"] for m in ev] == ["in_progress", "done"] and ev[-1]["author_name"]
    # status nie zmienia podglądu ani nieprzeczytanych po stronie pracownika
    assert me.get("/api/me/messages").json()[0]["preview"] == "W przyszłym tygodniu."
    assert me.get(f"/api/me/messages/{tid}").json()["messages"][-1]["author_name"] is None
    # odpowiedź kadr w zamkniętej rozmowie otwiera ją
    assert (
        hr.post(f"/api/hr-messages/{tid}/messages", json={"body": "Jeszcze jedno."}).json()["status"]
        == "in_progress"
    )
    hr.post(f"/api/hr-messages/{tid}/status", json={"status": "done"})
    # odpowiedź pracownika otwiera wątek ponownie
    r = me.post(f"/api/me/messages/{tid}/messages", json={"body": "Dziękuję, a gdzie?"})
    assert r.json()["status"] == "new"
    assert hr.get("/api/hr-messages/count").json()["new"] == 1


def test_hr_threads_isolated(me, hr, emp, make_user):  # noqa: F811
    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Hej"}).json()["id"]
    assert hr.get(f"/api/hr-messages/{tid}").status_code == 200
    assert me.get("/api/hr-messages").status_code == 403
    other = TestClient(app)
    token = _invite(hr, _second_employee())
    r = _activate(other, token, FakeAuthenticator())
    assert r.status_code == 200
    assert other.get(f"/api/me/messages/{tid}").status_code == 404
    assert other.get("/api/me/messages").json() == []


def _second_employee() -> int:
    from app.db import SessionLocal
    from app.models import Employee

    with SessionLocal() as db:
        e = Employee(first_name="Jan", last_name="Kowalski", birth_date=BORN)
        db.add(e)
        db.commit()
        return e.id


def test_stale_conversation_closes_itself(me, hr, emp):  # noqa: F811
    from datetime import timedelta

    from app.db import SessionLocal
    from app.deps import utcnow
    from app.models import HrThread

    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Pytanie"}).json()["id"]
    hr.post(f"/api/hr-messages/{tid}/messages", json={"body": "Odpowiedź"})
    # świeża rozmowa zostaje otwarta
    assert hr.get("/api/hr-messages").json()[0]["status"] == "in_progress"
    old = utcnow() - timedelta(days=4)
    with SessionLocal() as db:
        t = db.get(HrThread, tid)
        t.updated_at = old
        for m in t.messages:
            m.created_at = old
        db.commit()
    assert hr.get("/api/hr-messages").json()[0]["status"] == "done"
    ev = me.get(f"/api/me/messages/{tid}").json()["messages"][-1]
    assert ev["kind"] == "status" and ev["body"] == "done_auto"

    # rozmowa, na którą kadry jeszcze nie odpowiedziały, nigdy nie zamyka się sama
    tid2 = me.post("/api/me/messages", json={"subject": "Inne", "body": "Czekam"}).json()["id"]
    with SessionLocal() as db:
        t = db.get(HrThread, tid2)
        t.updated_at = old
        for m in t.messages:
            m.created_at = old
        db.commit()
    rows = {r["id"]: r for r in hr.get("/api/hr-messages").json()}
    assert rows[tid2]["status"] == "new"


def test_access_review(admin_client, make_user):
    from app.models import Role

    make_user("kier_x", Role.manager)
    rows = admin_client.get("/api/access-review/users").json()
    names = {r["username"]: r for r in rows}
    assert "nigdy się nie logował(-a)" in names["kier_x"]["flags"]
    assert any(r["role"] == "admin" and "pełne uprawnienia" in r["flags"] for r in rows)
    rep = admin_client.get("/api/access-review/pesel?days=7").json()
    assert rep["report_views"][0]["username"]  # oglądanie raportu jest w raporcie
    assert rep["days"] == 7 and rep["total"] == len(rep["recent"]) >= 0
    # tylko administrator
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/access-review/users").status_code == 401


def test_push_for_messages(me, hr, emp):  # noqa: F811
    from app import push

    push.outbox = []
    try:
        assert hr.post("/api/push/subscribe", json=_SUB_HR).status_code == 204
        assert me.post("/api/push/subscribe", json=_SUB_ME).status_code == 204
        tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Pytanie"}).json()["id"]
        assert any(
            t == "Nowa wiadomość od pracownika" and u.startswith("/wiadomosci?u=")
            for _, t, _, u in push.outbox
        )
        assert all("Pytanie" not in b for _, _, b, _ in push.outbox)  # treść wiadomości nie wychodzi w push
        push.outbox.clear()
        hr.post(f"/api/hr-messages/{tid}/messages", json={"body": "Odpowiedź"})
        assert [(t, u.split("?")[0]) for _, t, _, u in push.outbox] == [
            ("Odpowiedź od kadr", "/moje-konto/wiadomosci")
        ]
    finally:
        push.outbox = None


def test_deliver_payload_is_generic(monkeypatch, tmp_path):
    import json

    import pywebpush

    from app import push
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path))
    sent = []
    monkeypatch.setattr(pywebpush, "webpush", lambda **kw: sent.append(kw))
    push._deliver([(0, {"endpoint": "https://x.example/1", "keys": {}}, 7)], "Tytuł", "Treść", "/a")
    assert json.loads(sent[0]["data"]) == {"title": "Tytuł", "body": "Treść", "url": "/a?u=7"}
    assert sent[0]["vapid_claims"]["sub"]


_SUB_HR = {"endpoint": "https://push.example.com/hr1", "keys": {"p256dh": "B" * 40, "auth": "a" * 16}}
_SUB_ME = {"endpoint": "https://push.example.com/me1", "keys": {"p256dh": "C" * 40, "auth": "b" * 16}}


def test_staff_starts_conversation(me, hr, emp):  # noqa: F811
    from app import mailer, push

    mailer.outbox, push.outbox = [], []
    try:
        eid = emp
        assert (
            hr.post("/api/push/subscribe", json=_SUB_ME).status_code == 204
        )  # subskrypcja kadr, nie pracownika
        r = hr.post(
            "/api/hr-messages",
            json={"employee_id": eid, "subject": "Prośba o dokument", "body": "Proszę o skan"},
        )
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["status"] == "in_progress" and t["messages"][0]["from_staff"] is True
        # pracownik widzi nieprzeczytaną wiadomość od kadr i może odpowiedzieć
        assert me.get("/api/me/messages/count").json()["unread"] == 1
        rows = me.get("/api/me/messages").json()
        assert rows[0]["subject"] == "Prośba o dokument" and rows[0]["unread"] is True
        assert me.get(f"/api/me/messages/{t['id']}").status_code == 200
        assert me.get("/api/me/messages/count").json()["unread"] == 0
        assert me.post(f"/api/me/messages/{t['id']}/messages", json={"body": "Wysyłam"}).status_code == 200
        # kadry nie widzą własnej wiadomości jako nowej; powiadomienie e-mail bez treści i tematu
        assert all("Proszę o skan" not in m[2] and "Prośba o dokument" not in m[2] for m in mailer.outbox)
        # walidacja
        assert (
            hr.post(
                "/api/hr-messages", json={"employee_id": 999999, "subject": "Abc", "body": "x"}
            ).status_code
            == 404
        )
        assert (
            hr.post("/api/hr-messages", json={"employee_id": eid, "subject": "ab", "body": "x"}).status_code
            == 422
        )
        assert me.post(
            "/api/hr-messages", json={"employee_id": eid, "subject": "Abc", "body": "x"}
        ).status_code in (401, 403)
    finally:
        mailer.outbox, push.outbox = None, None
