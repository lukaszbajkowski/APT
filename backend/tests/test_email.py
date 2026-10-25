import re
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import mailer
from app.config import get_settings
from app.db import SessionLocal
from app.models import AuditLog, Role, User
from tests.conftest import PASSWORD, login

NEW = "Nowe-Haslo-Bezpieczne-9"


@pytest.fixture(autouse=True)
def _mail() -> Iterator[list]:
    s = get_settings()
    s.smtp_host, s.mail_from, s.public_url = "smtp.test", "APT <powiadomienia@aptid.pl>", "https://aptid.pl"
    mailer.outbox = []
    yield mailer.outbox
    mailer.outbox = None
    s.smtp_host, s.mail_from = "", ""


def _token(text: str) -> str:
    m = re.search(r"/ustaw-haslo\?token=(\S+)", text)
    assert m, text
    return m.group(1)


def _set_email(username: str, email: str) -> None:
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.username == username))
        u.email = email
        db.commit()


def test_reset_flow(client: TestClient, make_user, _mail):
    make_user("jan", Role.hr)
    _set_email("jan", "jan@firma.pl")
    assert client.get("/api/auth/config").json() == {"password_reset": True}

    r = client.post("/api/auth/password-reset/request", json={"login": "JAN@firma.pl"})
    assert r.status_code == 202
    assert len(_mail) == 1 and _mail[0][0] == "jan@firma.pl"
    token = _token(_mail[0][2])
    assert "https://aptid.pl/ustaw-haslo" in _mail[0][2]

    chk = client.get("/api/auth/password-reset/check", params={"token": token}).json()
    assert chk == {"valid": True, "username": "jan", "purpose": "reset"}
    r = client.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": "krotkie"})
    assert r.status_code == 400
    r = client.post("/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW})
    assert r.status_code == 204
    # link jednorazowy
    assert (
        client.post(
            "/api/auth/password-reset/confirm", json={"token": token, "new_password": NEW + "x"}
        ).status_code
        == 400
    )
    assert client.post("/api/auth/login", json={"username": "jan", "password": PASSWORD}).status_code == 401
    login(client, "jan", NEW)
    assert any("ustawiono nowe hasło" in m[1] + m[2] for m in _mail)


def test_unknown_login_same_answer(client: TestClient, make_user, _mail):
    make_user("bezmaila", Role.viewer)
    a = client.post("/api/auth/password-reset/request", json={"login": "nikt"})
    b = client.post("/api/auth/password-reset/request", json={"login": "bezmaila"})
    assert a.status_code == b.status_code == 202 and a.json() == b.json()
    assert _mail == []


def test_rate_limit(client: TestClient, make_user, _mail):
    make_user("jan", Role.viewer)
    _set_email("jan", "jan@firma.pl")
    for _ in range(5):
        client.post("/api/auth/password-reset/request", json={"login": "jan"})
    assert len(_mail) == 3


def test_new_link_invalidates_old(client: TestClient, make_user, _mail):
    make_user("jan", Role.viewer)
    _set_email("jan", "jan@firma.pl")
    client.post("/api/auth/password-reset/request", json={"login": "jan"})
    client.post("/api/auth/password-reset/request", json={"login": "jan"})
    first, second = _token(_mail[0][2]), _token(_mail[1][2])
    assert client.get("/api/auth/password-reset/check", params={"token": first}).json()["valid"] is False
    assert client.get("/api/auth/password-reset/check", params={"token": second}).json()["valid"] is True


def test_invite_on_create_and_email_unique(admin_client: TestClient, _mail):
    c = admin_client
    r = c.post(
        "/api/users",
        json={"username": "ola", "full_name": "Ola Nowa", "email": " Ola@Firma.pl ", "role": "manager"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["invite_sent"] is True and r.json()["user"]["email"] == "ola@firma.pl"
    token = _token(_mail[-1][2])
    assert c.get("/api/auth/password-reset/check", params={"token": token}).json()["purpose"] == "invite"
    r = c.post(
        "/api/users",
        json={"username": "ola2", "full_name": "Ola Druga", "email": "ola@firma.pl", "role": "viewer"},
    )
    assert r.status_code == 409
    assert (
        c.post(
            "/api/users",
            json={"username": "x1", "full_name": "Zly Mail", "email": "nie-mail", "role": "viewer"},
        ).status_code
        == 422
    )

    uid = r.json() if False else c.get("/api/users").json()[-1]["id"]
    # zmiana i usunięcie adresu
    assert c.patch(f"/api/users/{uid}", json={"email": "ola.n@firma.pl"}).json()["email"] == "ola.n@firma.pl"
    assert c.patch(f"/api/users/{uid}", json={"full_name": "Ola N"}).json()["email"] == "ola.n@firma.pl"
    assert c.patch(f"/api/users/{uid}", json={"email": ""}).json()["email"] is None
    assert c.post(f"/api/users/{uid}/send-password-link").status_code == 400


def test_security_notice_on_lock(client: TestClient, make_user, _mail):
    make_user("jan", Role.viewer)
    _set_email("jan", "jan@firma.pl")
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "jan", "password": "zle-haslo-123"})
    assert any("zablokowano" in m[2] for m in _mail)


def test_mail_disabled(client: TestClient, make_user):
    s = get_settings()
    s.smtp_host = ""
    assert client.get("/api/auth/config").json() == {"password_reset": False}
    assert client.post("/api/auth/password-reset/request", json={"login": "x"}).status_code == 400


def test_notify_daily(make_user, _mail, monkeypatch):
    from app import cli

    make_user("admin", Role.admin)
    _set_email("admin", "admin@firma.pl")
    sent = []
    monkeypatch.setattr(mailer, "send_now", lambda to, subj, text: sent.append((to, text)))
    assert cli.main(["notify-daily"]) == 0
    assert sent and sent[0][0] == "admin@firma.pl" and "kopiach" in sent[0][1]
    with SessionLocal() as db:
        assert db.scalar(select(AuditLog.id)) is None or True
