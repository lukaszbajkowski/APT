"""Tłumaczenie wiadomości (Google Cloud Translation): dostęp, limity, brak zapisu treści."""

import pytest
from sqlalchemy import select

from app import translate
from app.config import get_settings
from app.db import SessionLocal
from app.models import AuditLog
from tests.test_accounts import emp, hr  # noqa: F401, F811
from tests.test_me import me  # noqa: F401, F811

calls: list[tuple[str, dict]] = []


def fake_transport(path: str, payload: dict) -> dict:
    calls.append((path, payload))
    if path == "/languages":
        return {
            "data": {
                "languages": [
                    {"language": "uk", "name": "ukraiński"},
                    {"language": "en", "name": "angielski"},
                ]
            }
        }
    return {
        "data": {
            "translations": [
                {"translatedText": f"[{payload['target']}] {payload['q']}", "detectedSourceLanguage": "uk"}
            ]
        }
    }


@pytest.fixture(autouse=True)
def _provider(monkeypatch):
    calls.clear()
    translate._langs = None
    monkeypatch.setattr(translate, "transport", fake_transport)
    monkeypatch.setattr(get_settings(), "google_translate_key", "test-key")


def _thread(me, hr):  # noqa: F811
    tid = me.post("/api/me/messages", json={"subject": "Inne", "body": "Добрий день"}).json()["id"]
    msgs = hr.get(f"/api/hr-messages/{tid}").json()["messages"]
    return tid, msgs[0]["id"]


def test_disabled_without_key(me, hr, monkeypatch):  # noqa: F811
    monkeypatch.setattr(get_settings(), "google_translate_key", "")
    assert me.get("/api/translate/config").json() == {"enabled": False, "languages": []}
    _, mid = _thread(me, hr)
    assert me.post("/api/translate/message", json={"message_id": mid, "target": "pl"}).status_code == 404
    assert calls == []


def test_staff_and_employee_translate_their_thread(me, hr):  # noqa: F811
    cfg = hr.get("/api/translate/config").json()
    assert cfg["enabled"] is True and {"code": "uk", "name": "ukraiński"} in cfg["languages"]
    assert me.get("/api/translate/config").json()["enabled"] is True
    tid, mid = _thread(me, hr)
    r = hr.post("/api/translate/message", json={"message_id": mid, "target": "pl"})
    assert r.status_code == 200 and r.json() == {"text": "[pl] Добрий день", "source": "uk", "target": "pl"}
    hr.post(f"/api/hr-messages/{tid}/messages", json={"body": "Dzień dobry"})
    reply = [m for m in me.get(f"/api/me/messages/{tid}").json()["messages"] if m["kind"] == "message"][-1][
        "id"
    ]
    r = me.post("/api/translate/message", json={"message_id": reply, "target": "uk"})
    assert r.status_code == 200 and r.json()["text"] == "[uk] Dzień dobry"
    # w dzienniku zostaje fakt tłumaczenia, ale nie treść
    with SessionLocal() as db:
        rows = list(db.scalars(select(AuditLog).where(AuditLog.action == "message_translated")))
    assert len(rows) == 2
    assert all("Добрий" not in str(a.details) and "Dzień" not in str(a.details) for a in rows)


def test_cannot_translate_arbitrary_or_foreign_text(me, hr, make_user):  # noqa: F811
    tid, mid = _thread(me, hr)
    # zdarzenie zmiany statusu to nie wiadomość
    hr.post(f"/api/hr-messages/{tid}/status", json={"status": "done"})
    ev = [m for m in hr.get(f"/api/hr-messages/{tid}").json()["messages"] if m["kind"] == "status"][0]
    assert me.post("/api/translate/message", json={"message_id": ev["id"], "target": "pl"}).status_code == 404
    assert me.post("/api/translate/message", json={"message_id": 99999, "target": "pl"}).status_code == 404
    assert hr.post("/api/translate/message", json={"message_id": mid, "target": "p l"}).status_code in (
        400,
        422,
    )
    assert hr.post("/api/translate/message", json={"message_id": mid, "target": "../x"}).status_code in (
        400,
        422,
    )
    # inne konto pracownika nie przetłumaczy cudzej wiadomości
    from fastapi.testclient import TestClient

    from app.main import app
    from app.models import Role
    from tests.conftest import login

    make_user("kier2", Role.manager)
    m = TestClient(app)
    login(m, "kier2")
    assert m.post("/api/translate/message", json={"message_id": mid, "target": "pl"}).status_code == 403


def test_translation_is_rate_limited(me, hr, monkeypatch):  # noqa: F811
    from app.routers import translate as router

    monkeypatch.setattr(router, "PER_HOUR", 3)
    _, mid = _thread(me, hr)
    codes = [
        hr.post("/api/translate/message", json={"message_id": mid, "target": "en"}).status_code
        for _ in range(5)
    ]
    assert codes == [200, 200, 200, 429, 429]
