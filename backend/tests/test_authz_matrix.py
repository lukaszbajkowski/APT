"""Macierz uprawnień: konta spoza zakresu nie mogą czytać ani zmieniać cudzych pracowników i dokumentów."""

import re
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Role, User, UserScope
from tests.conftest import login, make_pesel
from tests.test_documents import simple_docx, upload


@pytest.fixture
def world(admin_client, make_user):
    c = admin_client
    a = c.post("/api/agencies", json={"name": "Agencja A"}).json()
    b = c.post("/api/agencies", json={"name": "Agencja B"}).json()
    d1 = c.post("/api/departments", json={"name": "Wydział 1"}).json()
    d2 = c.post("/api/departments", json={"name": "Wydział 2"}).json()

    def emp(first, ag, dep, serial):
        r = c.post(
            "/api/employees",
            json={
                "first_name": first,
                "last_name": "Test",
                "agency_id": ag["id"],
                "department_id": dep["id"],
                "pesel": make_pesel(date(1990, 1, 1), "M", serial),
                "hire_date": "2026-01-10",
            },
        )
        assert r.status_code == 201, r.text
        return r.json()

    mine, other = emp("Swój", a, d1, 111), emp("Obcy", b, d2, 222)
    t = upload(c, simple_docx("{{ nazwisko_imie }}"), "Szablon").json()
    doc = c.post(
        f"/api/employees/{other['id']}/documents", json={"template_id": t["id"], "pdf": False}
    ).json()
    types = c.get("/api/training-types").json()
    tr = c.post(
        f"/api/employees/{other['id']}/trainings",
        json={"type_id": types[0]["id"], "completed_on": "2026-01-15"},
    ).json()
    mgr = make_user("kier", Role.manager)
    ag = make_user("agen", Role.agency)
    make_user("podglad", Role.viewer)
    make_user("prac", Role.employee)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, department_id=d1["id"]))
        db.get(User, ag.id).agency_id = a["id"]
        db.commit()
    clients = {}
    for name in ("kier", "agen", "podglad"):
        cl = TestClient(app)
        login(cl, name)
        clients[name] = cl
    return {"admin": c, "other": other, "mine": mine, "doc": doc, "training": tr, "clients": clients}


def _paths(w):
    o, doc, tr = w["other"]["id"], w["doc"]["id"], w["training"]["id"]
    return [
        ("GET", f"/api/employees/{o}"),
        ("GET", f"/api/employees/{o}/account"),
        ("GET", f"/api/employees/{o}/checklists"),
        ("GET", f"/api/employees/{o}/documents"),
        ("GET", f"/api/employees/{o}/documents/trash"),
        ("GET", f"/api/employees/{o}/history"),
        ("GET", f"/api/employees/{o}/medical-exams"),
        ("GET", f"/api/employees/{o}/mentor-programs"),
        ("GET", f"/api/employees/{o}/photo"),
        ("GET", f"/api/employees/{o}/planned-changes"),
        ("GET", f"/api/employees/{o}/requirements"),
        ("GET", f"/api/employees/{o}/timeline"),
        ("GET", f"/api/employees/{o}/trainings"),
        ("GET", f"/api/employees/{o}/data-link"),
        ("POST", f"/api/employees/{o}/pesel"),
        ("PATCH", f"/api/employees/{o}"),
        ("POST", f"/api/employees/{o}/terminate"),
        ("POST", f"/api/employees/{o}/account/invite"),
        ("POST", f"/api/employees/{o}/account/reset"),
        ("POST", f"/api/employees/{o}/data-link"),
        ("DELETE", f"/api/employees/{o}/contact/email"),
        ("PUT", f"/api/employees/{o}/photo"),
        ("DELETE", f"/api/employees/{o}/photo"),
        ("POST", f"/api/employees/{o}/documents"),
        ("POST", f"/api/employees/{o}/trainings"),
        ("POST", f"/api/employees/{o}/medical-exams"),
        ("GET", f"/api/documents/{doc}/download"),
        ("GET", f"/api/documents/{doc}/view"),
        ("GET", f"/api/documents/{doc}/preview"),
        ("GET", f"/api/documents/{doc}/preview/1"),
        ("GET", f"/api/documents/{doc}/signatures"),
        ("GET", f"/api/documents/{doc}/signed"),
        ("GET", f"/api/documents/{doc}/timestamp"),
        ("POST", f"/api/documents/{doc}/signatures"),
        ("POST", f"/api/documents/{doc}/email"),
        ("POST", f"/api/documents/{doc}/delete"),
        ("POST", f"/api/documents/{doc}/restore"),
        ("PUT", f"/api/trainings/{tr}"),
        ("DELETE", f"/api/trainings/{tr}"),
        ("GET", f"/api/trainings/{tr}/scan"),
        ("POST", f"/api/trainings/{tr}/document"),
        ("GET", f"/api/employees/by-number/{w['other']['number']}"),
    ]


@pytest.mark.parametrize("who", ["kier", "agen", "podglad"])
def test_out_of_scope_accounts_get_no_foreign_data(world, who):
    cl = world["clients"][who]
    leaks = []
    for method, path in _paths(world):
        r = cl.request(method, path, json={} if method in ("POST", "PUT", "PATCH", "DELETE") else None)
        if r.status_code < 300 or r.status_code >= 500:
            leaks.append((method, path, r.status_code))
    # podgląd widzi wszystkich (tylko odczyt), więc dla niego dopuszczamy wyłącznie odczyty
    if who == "podglad":
        leaks = [x for x in leaks if x[0] != "GET"]
    assert not leaks, leaks


def test_employee_role_blocked_everywhere_but_own_area(world, client):
    from datetime import UTC, datetime, timedelta

    from app.deps import session_cookie
    from app.models import UserSession
    from app.security import new_token, token_hash

    with SessionLocal() as db:
        u = db.query(User).filter(User.username == "prac").one()
        tok, csrf, now = new_token(), new_token(), datetime.now(UTC)
        db.add(
            UserSession(
                token_hash=token_hash(tok),
                csrf_token=csrf,
                user_id=u.id,
                last_seen_at=now,
                expires_at=now + timedelta(hours=1),
            )
        )
        db.commit()
        uid = u.id
    client.cookies.set(session_cookie(uid), tok, path="/api")
    client.headers.update({"X-CSRF-Token": csrf, "X-APT-Account": str(uid)})
    assert client.get("/api/me/employee").status_code != 401  # sesja działa
    for method, path in _paths(world):
        r = client.request(method, path, json={} if method in ("POST", "PUT", "PATCH", "DELETE") else None)
        assert r.status_code in (401, 403), (method, path, r.status_code)


def test_list_endpoints_respect_scope(world):
    other_number = str(world["other"]["number"])
    for who in ("kier", "agen"):
        cl = world["clients"][who]
        r = cl.get("/api/employees", params={"q": "Obcy"})
        assert r.status_code == 200 and r.json()["total"] == 0, (who, r.text[:200])
        assert not re.search("Obcy", cl.get("/api/employees/ids").text)
        assert "Obcy" not in cl.get("/api/reports/employees.xlsx").content.decode("latin-1", "ignore")
        for p in ("/api/quality", "/api/tasks", "/api/trainings/expiring", "/api/trainings/matrix"):
            body = cl.get(p).text
            assert "Obcy" not in body and other_number not in body.replace('"', ""), (who, p)
