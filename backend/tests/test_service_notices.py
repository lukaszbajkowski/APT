from datetime import timedelta

from app.deps import utcnow
from app.models import Role


def _iso(d):
    return d.isoformat()


def test_service_notices_flow(admin_client):
    c = admin_client
    now = utcnow()
    # walidacja: blokujący wymaga końca, koniec po początku
    assert c.post("/api/service-notices", json={"kind": "repair", "title": "X", "blocking": True}).status_code == 422
    assert (
        c.post(
            "/api/service-notices",
            json={"kind": "planned", "title": "X", "starts_at": _iso(now), "ends_at": _iso(now - timedelta(hours=1))},
        ).status_code
        == 422
    )
    r = c.post(
        "/api/service-notices",
        json={
            "kind": "planned",
            "title": "Aktualizacja systemu",
            "body": "W sobotę od 22:00 aplikacja będzie niedostępna.",
            "starts_at": _iso(now + timedelta(days=1)),
            "ends_at": _iso(now + timedelta(days=1, hours=2)),
            "blocking": True,
        },
    )
    assert r.status_code == 201, r.text
    nid = r.json()["id"]
    assert r.json()["ongoing"] is False
    # szkic (nieopublikowany) nie jest widoczny publicznie
    c.post("/api/service-notices", json={"kind": "info", "title": "Szkic", "published": False})
    # publiczne – bez logowania
    c.post("/api/auth/logout")
    cur = c.get("/api/service-notices/current")
    assert cur.status_code == 200
    assert [n["title"] for n in cur.json()] == ["Aktualizacja systemu"]
    # lista administracyjna wymaga roli administratora
    assert c.get("/api/service-notices").status_code in (401, 403)


def test_service_notice_end_and_roles(admin_client, make_user):
    from tests.conftest import login

    c = admin_client
    now = utcnow()
    nid = c.post(
        "/api/service-notices",
        json={"kind": "repair", "title": "Prace naprawcze", "ends_at": _iso(now + timedelta(hours=1)), "blocking": True},
    ).json()["id"]
    cur = c.get("/api/service-notices/current").json()
    assert cur[0]["ongoing"] is True and cur[0]["blocking"] is True
    assert c.post(f"/api/service-notices/{nid}/end").status_code == 200
    assert c.get("/api/service-notices/current").json() == []
    assert len(c.get("/api/service-notices").json()) == 1
    assert c.delete(f"/api/service-notices/{nid}").status_code == 204
    # kadry nie zarządzają komunikatami technicznymi
    c.post("/api/auth/logout")
    make_user("kadry2", Role.hr)
    login(c, "kadry2")
    assert c.post("/api/service-notices", json={"kind": "info", "title": "X"}).status_code == 403
