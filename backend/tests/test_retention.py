from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select

from app import photos
from app.config import get_settings
from app.db import SessionLocal
from app.models import AuditLog, Employee, Role
from app.retention import retention_end
from tests.conftest import login
from tests.test_employees import _jpeg


def _emp(client, last="Stary", terminated: str | None = None) -> dict:
    e = client.post("/api/employees", json={"first_name": "Jan", "last_name": last}).json()
    if terminated:
        r = client.post(f"/api/employees/{e['id']}/terminate", json={"termination_date": terminated})
        assert r.status_code == 200, r.text
    return e


def test_retention_end_counts_from_end_of_year():
    assert retention_end(date(2026, 3, 1)) == date(2036, 12, 31)
    assert retention_end(date(2026, 12, 31)) == date(2036, 12, 31)
    assert retention_end(None) is None


def test_overview_buckets(admin_client):
    c = admin_client
    year = date.today().year
    due = _emp(c, "Dawny", f"{year - 12}-05-01")
    upcoming = _emp(c, "Prawie", f"{year - 10}-06-01")  # koniec okresu 31.12 bieżącego roku
    _emp(c, "Swiezy", f"{year}-01-15")
    _emp(c, "Aktywny")

    r = c.get("/api/retention")
    assert r.status_code == 200
    d = r.json()
    assert d["years"] == 10
    assert [i["id"] for i in d["due"]] == [due["id"]]
    assert [i["id"] for i in d["upcoming"]] == [upcoming["id"]]
    assert d["held"] == [] and d["missing_date"] == []
    assert d["due"][0]["retention_end"] == f"{year - 2}-12-31"
    assert c.get("/api/dashboard").json()["retention_due"] == 1
    # profil pokazuje datę
    assert c.get(f"/api/employees/{due['id']}").json()["retention_until"] == f"{year - 2}-12-31"


def test_only_admin(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    assert client.get("/api/retention").status_code == 403
    assert client.get("/api/dashboard").json()["retention_due"] is None


def test_purge_removes_data_and_files(admin_client):
    c = admin_client
    year = date.today().year
    e = _emp(c, "Dawny", f"{year - 12}-05-01")
    keep = _emp(c, "Swiezy", f"{year - 1}-05-01")
    assert (
        c.put(
            f"/api/employees/{e['id']}/photo", files={"file": ("x.jpg", _jpeg(600, 800), "image/jpeg")}
        ).status_code
        == 200
    )
    with SessionLocal() as db:
        photo_file = db.get(Employee, e["id"]).photo.file_name
    assert photos.path_for(photo_file).exists()
    docs = Path(get_settings().data_dir) / "documents" / str(e["id"])
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "x.pdf").write_bytes(b"%PDF")

    # potwierdzenie wymagane
    r = c.post("/api/retention/purge", json={"employee_ids": [e["id"]], "confirm": "tak"})
    assert r.status_code == 400
    # nie można usunąć kogoś, komu okres nie minął
    r = c.post("/api/retention/purge", json={"employee_ids": [e["id"], keep["id"]], "confirm": "USUŃ"})
    assert r.status_code == 409
    r = c.post("/api/retention/purge", json={"employee_ids": [e["id"]], "confirm": "usuń"})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 1

    assert c.get(f"/api/employees/{e['id']}").status_code == 404
    assert c.get(f"/api/employees/{keep['id']}").status_code == 200
    assert not photos.path_for(photo_file).exists()
    assert not docs.exists()
    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.action == "employee_purged")).one()
        assert "Dawny" not in str(log.details)
        assert log.details["number"] == e["number_display"]


def test_hold_postpones_deletion(admin_client):
    c = admin_client
    year = date.today().year
    e = _emp(c, "Dawny", f"{year - 12}-05-01")
    until = (date.today() + timedelta(days=200)).isoformat()

    assert c.post(f"/api/retention/{e['id']}/hold", json={"until": until}).status_code == 400  # brak powodu
    r = c.post(f"/api/retention/{e['id']}/hold", json={"until": until, "reason": "Sprawa w sądzie pracy"})
    assert r.status_code == 200, r.text
    d = c.get("/api/retention").json()
    assert d["due"] == [] and [i["id"] for i in d["held"]] == [e["id"]]
    assert d["held"][0]["hold_reason"] == "Sprawa w sądzie pracy"
    r = c.post("/api/retention/purge", json={"employee_ids": [e["id"]], "confirm": "USUŃ"})
    assert r.status_code == 409

    assert c.post(f"/api/retention/{e['id']}/hold", json={"until": None}).status_code == 200
    assert [i["id"] for i in c.get("/api/retention").json()["due"]] == [e["id"]]


def test_restore_clears_hold(admin_client):
    c = admin_client
    year = date.today().year
    e = _emp(c, "Dawny", f"{year - 12}-05-01")
    until = (date.today() + timedelta(days=30)).isoformat()
    c.post(f"/api/retention/{e['id']}/hold", json={"until": until, "reason": "x"})
    assert c.post(f"/api/employees/{e['id']}/restore").status_code == 200
    with SessionLocal() as db:
        emp = db.get(Employee, e["id"])
        assert emp.retention_hold_until is None and emp.retention_hold_reason is None
