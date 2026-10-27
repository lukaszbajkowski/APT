"""Kilka kont zalogowanych naraz w jednej przeglądarce (nagłówek, ?acct=, ostatnio aktywne)."""

from app.models import Role
from tests.conftest import PASSWORD


def _login(client, username):
    r = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def test_two_accounts_in_one_browser(client, make_user):
    admin = make_user("adm", Role.admin)
    viewer = make_user("podglad", Role.viewer)
    a = _login(client, "adm")
    v = _login(client, "podglad")

    # bez nagłówka obowiązuje ostatnio zalogowane konto
    assert client.get("/api/auth/me").json()["user"]["username"] == "podglad"
    # nagłówek wybiera konto (karta przeglądarki)
    me = client.get("/api/auth/me", headers={"X-APT-Account": str(admin.id)})
    assert me.json()["user"]["username"] == "adm"
    assert me.json()["csrf_token"] == a["csrf_token"]
    me = client.get("/api/auth/me", headers={"X-APT-Account": str(viewer.id)})
    assert me.json()["csrf_token"] == v["csrf_token"]
    # ?acct= działa jak nagłówek (obrazy, pobrania)
    assert client.get(f"/api/auth/me?acct={admin.id}").json()["user"]["username"] == "adm"

    # lista zalogowanych kont
    accounts = client.get("/api/auth/accounts").json()
    assert [x["username"] for x in accounts] == ["adm", "podglad"]

    # uprawnienia liczą się dla wybranego konta, nie dla ostatniego
    assert client.get("/api/users", headers={"X-APT-Account": str(admin.id)}).status_code == 200
    assert client.get("/api/users", headers={"X-APT-Account": str(viewer.id)}).status_code == 403


def test_logout_only_current_account(client, make_user):
    admin = make_user("adm2", Role.admin)
    viewer = make_user("podglad2", Role.viewer)
    a = _login(client, "adm2")
    _login(client, "podglad2")
    r = client.post(
        "/api/auth/logout",
        headers={"X-APT-Account": str(admin.id), "X-CSRF-Token": a["csrf_token"]},
    )
    assert r.status_code == 204
    assert client.get("/api/auth/me", headers={"X-APT-Account": str(admin.id)}).status_code == 401
    assert client.get("/api/auth/me", headers={"X-APT-Account": str(viewer.id)}).status_code == 200
    assert [x["username"] for x in client.get("/api/auth/accounts").json()] == ["podglad2"]


def test_cannot_use_other_accounts_cookie(client, make_user):
    admin = make_user("adm3", Role.admin)
    viewer = make_user("podglad3", Role.viewer)
    _login(client, "adm3")
    _login(client, "podglad3")
    # podszycie: ciasteczko konta „podglad3” pod identyfikatorem admina
    token = client.cookies.get(f"apt_session_{viewer.id}")
    client.cookies.set(f"apt_session_{admin.id}", token, path="/api")
    r = client.get("/api/auth/me", headers={"X-APT-Account": str(admin.id)})
    assert r.status_code == 401
    assert [x["username"] for x in client.get("/api/auth/accounts").json()] == ["podglad3"]


def test_set_active_account(client, make_user):
    admin = make_user("adm4", Role.admin)
    make_user("podglad4", Role.viewer)
    a = _login(client, "adm4")
    _login(client, "podglad4")
    r = client.post(
        "/api/auth/active",
        headers={"X-APT-Account": str(admin.id), "X-CSRF-Token": a["csrf_token"]},
    )
    assert r.status_code == 204
    assert client.get("/api/auth/me").json()["user"]["username"] == "adm4"
