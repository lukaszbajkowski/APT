"""Język pracownika: tłumaczenie stałych tekstów z pamięcią, ochrona zmiennych, e-maile i push."""

import pytest
from sqlalchemy import delete

from app import i18n, translate
from app.config import get_settings
from app.db import SessionLocal
from app.models import UiTranslation
from app.notify import account_sign_email
from tests.test_accounts import emp, hr  # noqa: F401, F811
from tests.test_me import me  # noqa: F401, F811

calls: list[dict] = []


def fake_transport(path: str, payload: dict) -> dict:
    calls.append(payload)
    if path == "/languages":
        return {"data": {"languages": [{"language": "uk", "name": "ukraiński"}]}}
    return {
        "data": {"translations": [{"translatedText": f"[{payload['target']}] {q}"} for q in payload["q"]]}
    }


@pytest.fixture(autouse=True)
def _provider(monkeypatch):
    calls.clear()
    translate._langs = None
    monkeypatch.setattr(translate, "transport", fake_transport)
    monkeypatch.setattr(get_settings(), "google_translate_key", "test-key")
    with SessionLocal() as db:
        db.execute(delete(UiTranslation))
        db.commit()


def test_strings_are_cached_and_variables_protected(me):  # noqa: F811
    body = {"lang": "uk", "strings": ["Do podpisu", "Dzień dobry {imie}", "Do podpisu"]}
    r = me.post("/api/i18n/strings", json=body)
    assert r.status_code == 200
    tr = r.json()["translations"]
    assert tr["Do podpisu"] == "[uk] Do podpisu"
    assert tr["Dzień dobry {imie}"] == "[uk] Dzień dobry {imie}"
    assert calls[0]["format"] == "html" and len(calls[0]["q"]) == 2
    assert '<span translate="no">{imie}</span>' in calls[0]["q"][1]
    n = len(calls)
    assert me.post("/api/i18n/strings", json=body).json()["translations"] == tr
    assert len(calls) == n  # drugi raz z pamięci, bez wywołania Google


def test_public_endpoint_and_validation(client):
    r = client.post("/api/i18n/public", json={"lang": "uk", "strings": ["Podpisz"]})
    assert r.status_code == 200 and r.json()["translations"]["Podpisz"] == "[uk] Podpisz"
    assert client.post("/api/i18n/public", json={"lang": "x", "strings": ["a"]}).status_code in (400, 422)
    assert client.post("/api/i18n/public", json={"lang": "pl", "strings": ["a"]}).status_code == 400
    long = {"lang": "uk", "strings": ["a" * 700]}
    assert client.post("/api/i18n/public", json=long).status_code == 400


def test_language_saved_on_account(me):  # noqa: F811
    assert me.put("/api/i18n/language", json={"language": "uk"}).status_code == 204
    assert me.get("/api/auth/me").json()["user"]["language"] == "uk"
    assert me.put("/api/i18n/language", json={"language": None}).status_code == 204
    assert me.get("/api/auth/me").json()["user"]["language"] is None
    assert me.put("/api/i18n/language", json={"language": "zły kod"}).status_code == 400


def test_staff_cannot_set_language(hr):  # noqa: F811
    assert hr.put("/api/i18n/language", json={"language": "uk"}).status_code == 403


def test_email_translated_and_falls_back_to_polish():
    with SessionLocal() as db:
        em = account_sign_email("Jan", "Umowa", "https://x/y", db, "uk")
        assert em.greeting == "[uk] Dzień dobry Jan,"
        assert "Umowa" in em.subject and em.button[1] == "https://x/y"
        pl = account_sign_email("Jan", "Umowa", "https://x/y", db, None)
        assert pl.greeting == "Dzień dobry Jan," and pl.subject == "Nowy dokument do podpisu: Umowa"
        assert i18n.t(db, "Cześć {a}", "uk", a="Ala") == "[uk] Cześć Ala"


def test_translation_failure_keeps_polish(monkeypatch):
    def boom(path, payload):
        raise translate.TranslateError("x")

    monkeypatch.setattr(translate, "transport", boom)
    with SessionLocal() as db:
        assert account_sign_email("Jan", "Umowa", "u", db, "uk").greeting == "Dzień dobry Jan,"


def test_languages_public(client, monkeypatch):
    r = client.get("/api/i18n/languages").json()
    assert r["enabled"] is True and {"code": "uk", "name": "ukraiński"} in r["languages"]
    monkeypatch.setattr(get_settings(), "google_translate_key", "")
    assert client.get("/api/i18n/languages").json() == {"enabled": False, "languages": []}


def test_push_from_hr_in_employee_language(me, hr):  # noqa: F811
    from app import push

    assert me.put("/api/i18n/language", json={"language": "uk"}).status_code == 204
    eid = me.get("/api/me/employee").json()
    emp_id = hr.get("/api/employee-accounts?status_filter=active").json()[0]["employee_id"]
    push.outbox = []
    try:
        # subskrypcja potrzebna, by push trafił do outboxa
        from app.db import SessionLocal as S
        from app.models import PushSubscription, User

        with S() as db:
            uid = db.query(User).filter(User.employee_id == emp_id).one().id
            db.add(PushSubscription(user_id=uid, endpoint="https://x/y", p256dh="a", auth="b"))
            db.commit()
        r = hr.post("/api/hr-messages", json={"employee_id": emp_id, "subject": "Temat", "body": "Cześć"})
        assert r.status_code in (200, 201), r.text
        assert push.outbox and push.outbox[-1][1] == "[uk] Wiadomość od kadr"
    finally:
        push.outbox = None
    assert eid


def test_broadcast_email_and_list_translated(me, hr, emp):  # noqa: F811
    from app import crypto, mailer
    from app.models import Employee

    me.put("/api/i18n/language", json={"language": "uk"})
    with SessionLocal() as db:
        e = db.get(Employee, emp)
        e.email_enc = crypto.encrypt_contact("anna@example.com")
        from datetime import UTC, datetime

        e.email_verified_at = datetime.now(UTC)
        db.commit()
    mailer.outbox = []
    r = hr.post(
        "/api/broadcasts", json={"subject": "Zmiana godzin", "body": "Od jutra {6:00}.", "everyone": True}
    )
    assert r.status_code == 201, r.text
    sent = [m for m in mailer.outbox if m[0] == "anna@example.com"]
    assert sent, mailer.outbox
    subject, text = sent[0][1], sent[0][2]
    assert subject.startswith("[uk] Zmiana godzin") and "[uk] Identyfikacja pracowników APT" in subject
    assert (
        "[uk] Dzień dobry Anna" in text
        and "[uk] Od jutra {6:00}." in text
        and "[uk] Otwórz w aplikacji" in text
    )
    mine = me.get("/api/me/broadcasts").json()[0]
    assert mine["subject"] == "[uk] Zmiana godzin"
    me.put("/api/i18n/language", json={"language": None})
    assert me.get("/api/me/broadcasts").json()[0]["subject"] == "Zmiana godzin"
