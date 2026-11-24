"""Zbieranie błędów: czyszczenie danych osobowych, grupowanie, zgłoszenia z przeglądarki, błędy 5xx API."""

from fastapi.testclient import TestClient

from app import errors
from app.main import app
from app.models import Role
from tests.conftest import login


def test_scrub_removes_personal_data():
    t = errors.scrub(
        "Nie znaleziono 85010112345 jan.kowalski@firma.pl w /api/x?q=Kowalski&id=7 tel 600700800", 500
    )
    assert "85010112345" not in t and "600700800" not in t
    assert "jan.kowalski" not in t and "Kowalski" not in t
    assert "?…" in t and "…@…" in t


def test_client_error_grouped_and_admin_only(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    body = {"kind": "TypeError", "message": "x is undefined (PESEL 85010112345)", "path": "/moje-konto"}
    assert client.post("/api/client-errors", json=body).status_code == 204
    assert client.post("/api/client-errors", json=body).status_code == 204
    # lista tylko dla administratora
    assert client.get("/api/system/errors").status_code == 403

    make_user("admin", Role.admin)
    client.headers.pop("X-CSRF-Token", None)
    client.cookies.clear()
    login(client, "admin")
    rows = client.get("/api/system/errors").json()
    assert len(rows) == 1
    e = rows[0]
    assert e["source"] == "browser" and e["count"] == 2 and e["role"] == "hr"
    assert "85010112345" not in e["message"]
    # „Rozwiązany” przenosi wpis do archiwum
    assert client.post(f"/api/system/errors/{e['id']}/resolve").status_code == 200
    assert client.get("/api/system/errors").json() == []


def test_client_error_requires_login(client):
    assert (
        client.post("/api/client-errors", json={"kind": "X", "message": "", "path": "/"}).status_code == 401
    )


def test_server_error_recorded_with_route_template(admin_client):
    def boom(item_id: int):
        raise RuntimeError(f"awaria dla 12345678 i {item_id}")

    app.add_api_route("/api/_test/boom/{item_id}", boom, methods=["GET"])
    try:
        c = TestClient(app, raise_server_exceptions=False)
        c.cookies.update(admin_client.cookies)
        assert c.get("/api/_test/boom/98765").status_code == 500
        rows = admin_client.get("/api/system/errors").json()
        api = [r for r in rows if r["source"] == "api"]
        assert api and api[0]["path"] == "GET /api/_test/boom/{item_id}"
        assert api[0]["kind"] == "RuntimeError" and "12345678" not in api[0]["message"]
    finally:
        app.router.routes = [
            r for r in app.router.routes if getattr(r, "path", "") != "/api/_test/boom/{item_id}"
        ]


def test_browser_rate_limit():
    errors._rate.clear()
    assert all(errors.browser_allowed(999) for _ in range(30))
    assert not errors.browser_allowed(999)


def test_resolved_errors_go_to_archive_and_come_back(client, make_user):
    """„Rozwiązany” przenosi wpis do archiwum; ten sam błąd wraca do bieżących (reopened), „Przywróć” cofa."""
    make_user("admin", Role.admin)
    login(client, "admin")
    errors.record("api", "RuntimeError", "coś poszło nie tak", "/api/x", 500)
    rows = client.get("/api/system/errors").json()
    eid = rows[0]["id"]
    r = client.post(f"/api/system/errors/{eid}/resolve")
    assert r.status_code == 200 and r.json()["resolved_by"]
    assert all(x["id"] != eid for x in client.get("/api/system/errors").json())
    arch = client.get("/api/system/errors", params={"resolved": True}).json()
    assert [x["id"] for x in arch] == [eid]
    assert client.get("/api/system/errors/counts").json() == {"open": 0, "resolved": 1}
    errors.record("api", "RuntimeError", "coś poszło nie tak", "/api/x", 500)
    back = client.get("/api/system/errors").json()
    assert back[0]["id"] == eid and back[0]["reopened"] is True and back[0]["count"] == 2
    client.post(f"/api/system/errors/{eid}/resolve")
    assert client.post(f"/api/system/errors/{eid}/reopen").json()["resolved_at"] is None
