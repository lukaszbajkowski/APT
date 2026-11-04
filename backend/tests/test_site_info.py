from app.models import Role
from tests.conftest import login


def test_site_info_public_read_admin_write(admin_client, make_user):
    c = admin_client
    # pusty stan – czytelny bez logowania
    c.post("/api/auth/logout")
    r = c.get("/api/site-info")
    assert r.status_code == 200 and r.json()["privacy_text"] == "" and r.json()["updated_at"] is None
    # zapis tylko dla administratora
    assert c.put("/api/site-info", json={"contact_name": "Kadry"}).status_code == 401
    make_user("kadry3", Role.hr)
    login(c, "kadry3")
    assert c.put("/api/site-info", json={"contact_name": "Kadry"}).status_code == 403
    c.post("/api/auth/logout")
    login(c, "admin")
    assert c.put("/api/site-info", json={"contact_email": "zly-adres"}).status_code == 422
    assert c.put("/api/site-info", json={"contact_phone": "<script>"}).status_code == 422
    r = c.put(
        "/api/site-info",
        json={"contact_name": " Dział kadr ", "contact_email": "kadry@example.com", "contact_phone": "+48 600 100 200",
              "contact_hours": "pn–pt 8–16", "privacy_text": "## Administrator danych\nAPT sp. z o.o."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["contact_name"] == "Dział kadr"
    # pusty e-mail czyści pole
    assert c.put("/api/site-info", json={**r.json(), "contact_email": ""}).json()["contact_email"] == ""
    c.post("/api/auth/logout")
    pub = c.get("/api/site-info").json()
    assert pub["contact_phone"] == "+48 600 100 200" and pub["privacy_text"].startswith("## Administrator")
