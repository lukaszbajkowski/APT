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


_SUB_HR = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/hr1",
    "keys": {"p256dh": "B" * 40, "auth": "a" * 16},
}
_SUB_ME = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/me1",
    "keys": {"p256dh": "C" * 40, "auth": "b" * 16},
}


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


def test_archive_threads_per_side(me, hr, emp):  # noqa: F811
    from datetime import timedelta

    from app.cli import close_stale_threads
    from app.db import SessionLocal
    from app.deps import utcnow
    from app.models import HrThread

    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Pytanie"}).json()["id"]
    # tylko zakończone można archiwizować
    assert hr.post(f"/api/hr-messages/{tid}/archive").status_code == 400
    assert me.post(f"/api/me/messages/{tid}/archive").status_code == 400
    hr.post(f"/api/hr-messages/{tid}/status", json={"status": "done"})
    # kadry archiwizują po swojej stronie – pracownik dalej widzi rozmowę
    assert hr.post(f"/api/hr-messages/{tid}/archive").json()["archived"] is True
    assert hr.get("/api/hr-messages").json() == []
    arch = hr.get("/api/hr-messages", params={"archived": True}).json()
    assert [r["id"] for r in arch] == [tid] and arch[0]["archived"] is True
    assert [r["id"] for r in me.get("/api/me/messages").json()] == [tid]
    # pracownik archiwizuje po swojej
    assert me.post(f"/api/me/messages/{tid}/archive").json()["archived"] is True
    assert me.get("/api/me/messages").json() == []
    assert [r["id"] for r in me.get("/api/me/messages", params={"archived": True}).json()] == [tid]
    # przywrócenie
    assert me.post(f"/api/me/messages/{tid}/unarchive").json()["archived"] is False
    assert [r["id"] for r in me.get("/api/me/messages").json()] == [tid]
    # nowa wiadomość pracownika wyciąga rozmowę z archiwum kadr
    me.post(f"/api/me/messages/{tid}/messages", json={"body": "Jeszcze jedno"})
    assert [r["id"] for r in hr.get("/api/hr-messages").json()] == [tid]
    assert hr.get("/api/hr-messages", params={"archived": True}).json() == []
    # obca rozmowa: 404
    assert me.post("/api/me/messages/99999/archive").status_code == 404

    # automat: zakończona i nieruszana ponad 30 dni
    hr.post(f"/api/hr-messages/{tid}/status", json={"status": "done"})
    with SessionLocal() as db:
        db.get(HrThread, tid).updated_at = utcnow() - timedelta(days=31)
        db.commit()
    assert close_stale_threads() == 0
    assert hr.get("/api/hr-messages").json() == []
    assert me.get("/api/me/messages").json() == []
    assert len(hr.get("/api/hr-messages", params={"archived": True}).json()) == 1
    assert len(me.get("/api/me/messages", params={"archived": True}).json()) == 1


def _second_account(hr):  # noqa: F811
    eid = _second_employee()
    c = TestClient(app)
    r = _activate(c, _invite(hr, eid), FakeAuthenticator())
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return eid, c


def test_message_to_several_separate(me, hr, emp):  # noqa: F811
    eid2, other = _second_account(hr)
    r = hr.post(
        "/api/hr-messages",
        json={"employee_ids": [emp, eid2], "mode": "separate", "subject": "Odzież", "body": "Piątek 8:00"},
    )
    assert r.status_code == 201, r.text
    rows = [x for x in hr.get("/api/hr-messages").json() if x["subject"] == "Odzież"]
    assert len(rows) == 2 and all(x["batch_size"] == 2 and not x["is_group"] for x in rows)
    # każdy widzi tylko swoją rozmowę; odpowiedź jednej osoby nie trafia do drugiej
    mine = me.get("/api/me/messages").json()
    assert len(mine) == 1 and mine[0]["batch_size"] is None
    me.post(f"/api/me/messages/{mine[0]['id']}/messages", json={"body": "Mogę o 11?"})
    theirs = other.get(f"/api/me/messages/{other.get('/api/me/messages').json()[0]['id']}").json()
    assert [m["body"] for m in theirs["messages"]] == ["Piątek 8:00"]


def test_message_to_several_group(me, hr, emp):  # noqa: F811
    eid2, other = _second_account(hr)
    r = hr.post(
        "/api/hr-messages",
        json={"employee_ids": [emp, eid2], "mode": "group", "subject": "Zmiana", "body": "Nowy grafik"},
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["is_group"] and len(t["members"]) == 2 and t["employee_id"] is None
    tid = t["id"]
    me.post(f"/api/me/messages/{tid}/messages", json={"body": "Dziękuję"})
    seen = other.get(f"/api/me/messages/{tid}").json()
    msgs = [m for m in seen["messages"] if m["kind"] == "message"]
    assert [m["body"] for m in msgs] == ["Nowy grafik", "Dziękuję"]
    assert msgs[1]["author_name"] and not msgs[1]["mine"]
    # nieprzeczytane liczone osobno dla każdego uczestnika
    assert other.get("/api/me/messages/count").json()["unread"] == 0
    other.post(f"/api/me/messages/{tid}/messages", json={"body": "Ja też"})
    assert me.get("/api/me/messages/count").json()["unread"] == 1
    assert hr.get(f"/api/hr-messages/{tid}").json()["messages"][-1]["author_name"]
    # osoba spoza grupy nie widzi rozmowy
    hr.post("/api/hr-messages", json={"employee_ids": [emp], "subject": "Inna", "body": "x"})
    assert other.get("/api/me/messages/count").status_code == 200


def test_message_to_several_needs_accounts(me, hr, emp):  # noqa: F811
    no_account = _second_employee()
    r = hr.post(
        "/api/hr-messages",
        json={"employee_ids": [emp, no_account], "mode": "group", "subject": "Zmiana", "body": "x"},
    )
    assert r.status_code == 400 and "Kowalski Jan" in r.json()["detail"]


def _png(w=640, h=480) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 160, 120)).save(buf, "PNG")
    return buf.getvalue()


def test_message_files(me, hr, emp):  # noqa: F811
    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Zwolnienie"}).json()["id"]
    r = me.post(
        f"/api/me/messages/{tid}/files",
        files=[
            ("files", ("L4.png", _png(), "image/png")),
            ("files", ("skan.pdf", b"%PDF-1.4 test", "application/pdf")),
        ],
    )
    assert r.status_code == 200, r.text
    m = r.json()["messages"][-1]
    assert m["body"] == "" and [f["kind"] for f in m["files"]] == ["image", "file"]
    img, pdf = m["files"]
    assert img["name"] == "L4.jpg" and img["width"] == 640
    # kadry widzą plik i miniaturę; wiersz listy opisuje załącznik
    assert hr.get(f"/api/hr-messages/files/{img['id']}?thumb=1").headers["content-type"] == "image/jpeg"
    assert hr.get(f"/api/hr-messages/files/{pdf['id']}").content.startswith(b"%PDF")
    assert hr.get("/api/hr-messages").json()[0]["preview"].startswith("Zdjęcie")
    # kadry odpowiadają plikiem z opisem
    r = hr.post(
        f"/api/hr-messages/{tid}/files",
        data={"body": "Grafik"},
        files=[("files", ("g.pdf", b"%PDF-1.4 x", "application/pdf"))],
    )
    assert (
        r.status_code == 200
        and [x for x in r.json()["messages"] if x["kind"] == "message"][-1]["body"] == "Grafik"
    )
    # obca osoba nie pobierze pliku, zły typ jest odrzucany
    eid2, other = _second_account(hr)
    assert other.get(f"/api/me/messages/files/{img['id']}").status_code == 404
    bad = me.post(
        f"/api/me/messages/{tid}/files",
        files=[("files", ("x.exe", b"MZ\x00\x00", "application/octet-stream"))],
    )
    assert bad.status_code == 400 and "dozwolone" in bad.json()["detail"].lower()
    assert me.post(f"/api/me/messages/{tid}/files", data={"body": ""}).status_code == 400


def test_message_office_preview(me, hr, emp):  # noqa: F811
    from app import templating

    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Plan"}).json()["id"]
    r = me.post(
        f"/api/me/messages/{tid}/files",
        files=[("files", ("plan.txt", "Grafik\nPoniedziałek 8–16".encode(), "text/plain"))],
    )
    assert r.status_code == 200, r.text
    f = r.json()["messages"][-1]["files"][0]
    assert f["ext"] == "txt" and f["kind"] == "file"
    # typ MIME pliku Word ma ponad 50 znaków
    zipped = io.BytesIO()
    import zipfile

    with zipfile.ZipFile(zipped, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    w = me.post(
        f"/api/me/messages/{tid}/files",
        files=[("files", ("umowa.docx", zipped.getvalue(), "application/zip"))],
    )
    assert w.status_code == 200 and w.json()["messages"][-1]["files"][0]["ext"] == "docx"
    assert "attachment" in hr.get(f"/api/hr-messages/files/{f['id']}").headers["content-disposition"]
    fake = me.post(
        f"/api/me/messages/{tid}/files",
        files=[("files", ("x.docx", b"not a zip", "application/octet-stream"))],
    )
    assert fake.status_code == 400
    if templating.soffice_path():
        info = hr.get(f"/api/hr-messages/files/{f['id']}/preview").json()
        assert info["pages"] == 1 and info["title"] == "plan.txt"
        page = me.get(f"/api/me/messages/files/{f['id']}/preview/page/0")
        assert page.status_code == 200 and page.content.startswith(b"\x89PNG")


def test_message_special_formats(me, hr, emp):  # noqa: F811
    import openpyxl

    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Pliki"}).json()["id"]

    def send(name, data):
        r = me.post(
            f"/api/me/messages/{tid}/files", files=[("files", (name, data, "application/octet-stream"))]
        )
        assert r.status_code == 200, r.text
        return r.json()["messages"][-1]["files"][0]

    # HEIC z iPhone'a → JPG
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
        buf = io.BytesIO()
        Image.new("RGB", (400, 300), (10, 120, 200)).save(buf, "HEIF")
        f = send("IMG_0001.HEIC", buf.getvalue())
        assert f["kind"] == "image" and f["name"] == "IMG_0001.jpg"
    except ImportError:
        pass
    # nagranie głosowe – odtwarzanie z zakresem bajtów
    a = send("notatka.m4a", b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 200)
    assert a["kind"] == "audio"
    assert hr.get("/api/hr-messages").json()[0]["preview"] == "Wiadomość głosowa"
    r = hr.get(f"/api/hr-messages/files/{a['id']}", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and len(r.content) == 10 and r.headers["content-range"] == "bytes 0-9/212"
    # tekst w aplikacji
    t = send("notatka.txt", "Zażółć gęślą jaźń".encode("cp1250"))
    assert hr.get(f"/api/hr-messages/files/{t['id']}/text").json()["text"] == "Zażółć gęślą jaźń"
    # CSV i XLSX jako tabela z arkuszami
    c = send("lista.csv", b"Nazwisko;Zmiana\nKowalski;I\nNowak;II\n")
    sheet = me.get(f"/api/me/messages/files/{c['id']}/table").json()["sheets"][0]
    assert sheet["rows"][2] == ["Nowak", "II"]
    wb = openpyxl.Workbook()
    wb.active.title = "Grafik"
    wb.active.append(["Dzień", "Godziny"])
    wb.active.append(["Pon", 8.5])
    wb.create_sheet("Urlopy").append(["Nowak", "1–5.12"])
    xb = io.BytesIO()
    wb.save(xb)
    x = send("grafik.xlsx", xb.getvalue())
    sheets = hr.get(f"/api/hr-messages/files/{x['id']}/table").json()["sheets"]
    assert [s["name"] for s in sheets] == ["Grafik", "Urlopy"] and sheets[0]["rows"][1] == ["Pon", "8,5"]
    assert hr.get(f"/api/hr-messages/files/{a['id']}/table").status_code == 400
