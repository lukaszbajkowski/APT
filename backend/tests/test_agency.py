import io
from datetime import date, timedelta

from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import select

from app import agency_report, mailer
from app.db import SessionLocal
from app.main import app
from app.models import Assignment, AuditLog, Employee, EmploymentPeriod, Role, User
from tests.conftest import login, make_pesel
from tests.test_employees import _jpeg


def _agencies(c):
    a = c.post("/api/agencies", json={"name": "Agencja A", "email": "kadry@a.pl; biuro@a.pl"}).json()
    b = c.post("/api/agencies", json={"name": "Agencja B"}).json()
    return a, b


def test_agency_email_validation(admin_client):
    c = admin_client
    a, _ = _agencies(c)
    assert a["email"] == "kadry@a.pl, biuro@a.pl"
    assert c.patch(f"/api/agencies/{a['id']}", json={"email": "zly-adres"}).status_code == 400
    d = c.post("/api/departments", json={"name": "Magazyn", "email": "x@y.pl"}).json()
    assert d["email"] is None  # wydział nie ma adresu


def test_monthly_report_periods(admin_client):
    c = admin_client
    a, b = _agencies(c)
    # stały pracownik A
    c.post(
        "/api/employees",
        json={"first_name": "Stały", "last_name": "Adam", "agency_id": a["id"], "hire_date": "2026-01-10"},
    )
    # przyjęty 15.09 do A
    c.post(
        "/api/employees",
        json={"first_name": "Nowy", "last_name": "Bogdan", "agency_id": a["id"], "hire_date": "2026-09-15"},
    )
    # w B, przeniesiony do A od 20.09
    e3 = c.post(
        "/api/employees",
        json={"first_name": "Przen", "last_name": "Cezary", "agency_id": b["id"], "hire_date": "2026-05-01"},
    ).json()
    # zwolniony 10.09 z A
    e4 = c.post(
        "/api/employees",
        json={"first_name": "Odch", "last_name": "Damian", "agency_id": a["id"], "hire_date": "2026-03-01"},
    ).json()
    # w A tylko w poprzednim okresie zatrudnienia (2025)
    e5 = c.post(
        "/api/employees",
        json={"first_name": "Dawny", "last_name": "Edward", "agency_id": b["id"], "hire_date": "2026-08-01"},
    ).json()
    with SessionLocal() as db:
        x = db.get(Employee, e3["id"])
        x.agency_id = a["id"]
        db.add(
            Assignment(
                employee_id=x.id, valid_from=date(2026, 9, 20), agency_name="Agencja A", reason="zmiana"
            )
        )
        y = db.get(Employee, e4["id"])
        y.termination_date = date(2026, 9, 10)
        db.add(
            EmploymentPeriod(
                employee_id=e5["id"],
                hire_date=date(2025, 1, 1),
                termination_date=date(2025, 6, 30),
                agency_name="Agencja A",
            )
        )
        db.commit()

    r = c.get("/api/agency-report", params={"agency_id": a["id"], "month": "2026-09"}).json()
    rows = {x["last_name"]: x for x in r["rows"]}
    assert set(rows) == {"Adam", "Bogdan", "Cezary", "Damian"}
    assert rows["Adam"]["days"] == 30 and rows["Adam"]["change"] == ""
    assert rows["Bogdan"]["period_from"] == "2026-09-15" and rows["Bogdan"]["change"] == "przyjęty"
    assert rows["Cezary"]["period_from"] == "2026-09-20" and rows["Cezary"]["days"] == 11
    assert rows["Damian"]["period_to"] == "2026-09-10" and rows["Damian"]["change"] == "odszedł"
    assert r["people"] == 4 and r["came"] == 1 and r["left"] == 1
    assert r["recipients"] == ["kadry@a.pl", "biuro@a.pl"]
    # B we wrześniu: Cezary do 19.09, Edward cały miesiąc
    rb = {
        x["last_name"]: x
        for x in c.get("/api/agency-report", params={"agency_id": b["id"], "month": "2026-09"}).json()["rows"]
    }
    assert rb["Cezary"]["period_to"] == "2026-09-19" and "Edward" in rb
    # 2025: Edward w A (poprzedni okres)
    r25 = c.get("/api/agency-report", params={"agency_id": a["id"], "month": "2025-03"}).json()
    assert [x["last_name"] for x in r25["rows"]] == ["Edward"]

    # zmiana nazwy APT – historia ma starą nazwę, a osoby nadal są w zestawieniu
    c.patch(f"/api/agencies/{a['id']}", json={"name": "Agencja A Nowa"})
    renamed = c.get("/api/agency-report", params={"agency_id": a["id"], "month": "2026-10"}).json()
    assert {"Adam", "Bogdan", "Cezary"} <= {x["last_name"] for x in renamed["rows"]}
    c.patch(f"/api/agencies/{a['id']}", json={"name": "Agencja A"})

    x = c.get("/api/agency-report/xlsx", params={"agency_id": a["id"], "month": "2026-09"})
    ws = load_workbook(io.BytesIO(x.content)).active
    assert ws["A1"].value.startswith("Zestawienie osób – Agencja A – wrzesień 2026")
    assert ws.max_row == 4 + 4


def test_send_manual_and_monthly(admin_client, make_user):
    c = admin_client
    a, b = _agencies(c)
    c.post(
        "/api/employees",
        json={"first_name": "Jan", "last_name": "K", "agency_id": a["id"], "hire_date": "2026-01-01"},
    )
    hr = make_user("kadry", Role.hr)
    with SessionLocal() as db:
        db.get(User, hr.id).email = "hr@firma.pl"
        db.commit()
    mailer.outbox = []
    try:
        r = c.post("/api/agency-report/send", json={"agency_id": a["id"], "month": "2026-09"})
        assert r.json()["sent_to"] == ["kadry@a.pl", "biuro@a.pl", "hr@firma.pl"]
        assert (
            c.post("/api/agency-report/send", json={"agency_id": b["id"], "month": "2026-09"}).status_code
            == 400
        )
        assert c.get("/api/agency-report", params={"agency_id": a["id"], "month": "2026-09"}).json()[
            "last_sent_at"
        ]

        mailer.outbox.clear()
        with SessionLocal() as db:
            assert agency_report.send_monthly(db, date(2026, 11, 1)) == 1  # tylko A ma adres
            assert agency_report.send_monthly(db, date(2026, 11, 1)) == 0  # drugi raz – nie
        assert {t for t, *_ in mailer.outbox} == {"kadry@a.pl", "biuro@a.pl", "hr@firma.pl"}
        assert "październik 2026" in mailer.outbox[0][1]
    finally:
        mailer.outbox = None


def _agency_user(c, make_user, agency_id):
    u = make_user("agencja", Role.agency)
    with SessionLocal() as db:
        db.get(User, u.id).agency_id = agency_id
        db.commit()
    ac = TestClient(app)
    login(ac, "agencja")
    return ac


def test_agency_account_access(admin_client, make_user):
    c = admin_client
    a, b = _agencies(c)
    pesel = make_pesel(date(1990, 1, 2), "M")
    mine = c.post(
        "/api/employees",
        json={
            "first_name": "Mój",
            "last_name": "Pracownik",
            "agency_id": a["id"],
            "pesel": pesel,
            "notes": "wewnętrzne",
        },
    ).json()
    other = c.post(
        "/api/employees", json={"first_name": "Cudzy", "last_name": "Ktoś", "agency_id": b["id"]}
    ).json()
    ac = _agency_user(c, make_user, a["id"])

    items = ac.get("/api/employees").json()["items"]
    assert [x["id"] for x in items] == [mine["id"]]
    me = ac.get(f"/api/employees/{mine['id']}").json()
    assert me["pesel_masked"] is None and me["birth_date"] is None and me["notes"] is None
    assert ac.get(f"/api/employees/{other['id']}").status_code == 404
    # bez edycji kartoteki, dokumentów, szkoleń, checklist, raportów
    assert ac.patch(f"/api/employees/{mine['id']}", json={"first_name": "X"}).status_code == 403
    assert ac.get(f"/api/employees/{mine['id']}/documents").status_code == 403
    assert ac.get(f"/api/employees/{mine['id']}/trainings").status_code == 403
    assert ac.get(f"/api/employees/{mine['id']}/checklists").status_code == 403
    assert ac.get("/api/reports/employees").status_code in (403, 404)
    assert ac.get("/api/users").status_code == 403
    assert ac.post("/api/employees", json={"first_name": "A", "last_name": "B"}).status_code == 403
    # zestawienie – tylko własna APT, bez wysyłki
    rep = ac.get("/api/agency-report", params={"agency_id": b["id"], "month": "2026-09"}).json()
    assert rep["agency"] == "Agencja A"
    assert (
        ac.post("/api/agency-report/send", json={"agency_id": a["id"], "month": "2026-09"}).status_code == 403
    )

    # zdjęcie
    r = ac.put(
        f"/api/employees/{mine['id']}/photo", files={"file": ("x.jpg", _jpeg(800, 1000), "image/jpeg")}
    )
    assert r.status_code == 200 and r.json()["has_photo"]
    assert (
        ac.put(
            f"/api/employees/{other['id']}/photo", files={"file": ("x.jpg", _jpeg(800, 1000), "image/jpeg")}
        ).status_code
        == 404
    )

    # badania lekarskie
    today = date.today()
    r = ac.post(
        f"/api/employees/{mine['id']}/medical-exams",
        data={"kind": "wstepne", "exam_date": str(today), "valid_until": str(today + timedelta(days=10))},
        files={"file": ("badanie.pdf", b"%PDF-1.4 badanie", "application/pdf")},
    )
    assert r.status_code == 201, r.text
    ex = r.json()
    assert ex["state"] == "expiring" and ex["has_file"] and ex["can_delete"]
    assert ac.get(f"/api/medical-exams/{ex['id']}/file").content == b"%PDF-1.4 badanie"
    from pathlib import Path

    from app.config import get_settings

    med = list((Path(get_settings().data_dir) / "medical" / str(mine["id"])).iterdir())
    assert med and all(p.read_bytes().startswith(b"APTF") for p in med)
    assert c.get(f"/api/employees/{mine['id']}/medical-exams").json()[0]["id"] == ex["id"]
    up = ac.get("/api/dashboard/upcoming").json()
    assert [u["kind"] for u in up] == ["medical"]
    bad = ac.post(
        f"/api/employees/{mine['id']}/medical-exams",
        data={"kind": "okresowe", "exam_date": str(today + timedelta(days=1))},
    )
    assert bad.status_code == 400
    assert ac.delete(f"/api/medical-exams/{ex['id']}").status_code == 204


def test_employee_requests(admin_client, make_user):
    c = admin_client
    a, _ = _agencies(c)
    ac = _agency_user(c, make_user, a["id"])
    assert (
        ac.post(
            "/api/employee-requests", json={"first_name": "Ola", "last_name": "Nowa", "pesel": "123"}
        ).status_code
        == 400
    )
    pesel = make_pesel(date(1995, 3, 4), "K")
    r = ac.post(
        "/api/employee-requests",
        json={"first_name": "Ola", "last_name": "Nowa", "pesel": pesel, "hire_date": "2026-11-02"},
    )
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["pesel"].startswith("•") and req["status"] == "pending"
    full = c.get("/api/employee-requests").json()[0]
    assert full["pesel"] == pesel and full["birth_date"] == "1995-03-04"
    # kadry zatwierdzają – powstaje pracownik w APT agencji
    ok = c.post(f"/api/employee-requests/{req['id']}/approve", json={}).json()
    assert ok["status"] == "approved" and ok["employee_id"]
    emp = c.get(f"/api/employees/{ok['employee_id']}").json()
    assert emp["agency"]["id"] == a["id"] and emp["has_pesel"] and emp["hire_date"] == "2026-11-02"
    assert c.post(f"/api/employee-requests/{req['id']}/approve", json={}).status_code == 409
    assert [x["id"] for x in ac.get("/api/employees").json()["items"]] == [ok["employee_id"]]

    # drugie zgłoszenie – duplikat PESEL → kadry widzą konflikt; odrzucenie
    r2 = ac.post(
        "/api/employee-requests", json={"first_name": "Ola", "last_name": "Nowa", "pesel": pesel}
    ).json()
    assert c.post(f"/api/employee-requests/{r2['id']}/approve", json={}).status_code == 409
    rej = c.post(f"/api/employee-requests/{r2['id']}/reject", json={"reason": "już jest w kartotece"}).json()
    assert rej["status"] == "rejected" and rej["pesel"] is None
    with SessionLocal() as db:
        acts = [x.action for x in db.scalars(select(AuditLog))]
        assert "employee_request_approved" in acts and "employee_request_rejected" in acts
    # inne APT nie widzą zgłoszeń
    assert ac.post(f"/api/employee-requests/{r2['id']}/reject", json={"reason": "xxx"}).status_code == 403
