import io
import json
from datetime import date

from openpyxl import Workbook
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, Department
from tests.conftest import make_pesel
from tests.test_trainings import _emp, _types


def _xlsx(rows):
    wb = Workbook()
    for r in rows:
        wb.active.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


HEAD = ["Nr ewidencyjny", "PESEL", "Nazwisko", "Imię", "Rodzaj", "Szkolenie", "Wydział", "Data rozpoczęcia",
        "Data zakończenia", "Ważne do", "Opiekun", "Uwagi"]  # fmt: skip


def test_import_trainings(admin_client):
    c = admin_client
    with SessionLocal() as db:
        db.add(Department(name="Montaż"))
        db.commit()
        dep = db.scalar(select(Department.id))
    pesel = make_pesel(date(1990, 5, 1), "K")
    a = _emp(c, pesel=pesel)
    b = _emp(c, "Jan", "Kowal")
    m = _emp(c, "Piotr", "Opiekun")
    pos = _types(c)["Szkolenie stanowiskowe"]["id"]
    c.post(
        f"/api/training-types/{pos}/programs",
        json={"name": "Operator prasy", "department_id": dep, "standard_days": 10},
    )
    data = _xlsx(
        [
            HEAD,
            [
                None,
                pesel,
                None,
                None,
                "Szkolenie BHP okresowe",
                None,
                None,
                None,
                "15.01.2026",
                None,
                None,
                "grupa A",
            ],
            [
                b["number"],
                None,
                None,
                None,
                None,
                "Operator prasy",
                None,
                "01.03.2026",
                "12.03.2026",
                None,
                "Opiekun Piotr",
                None,
            ],  # noqa: E501
            [None, None, "Kowal", "Jan", "Nieznany rodzaj", None, None, None, None, None, None, None],
            [None, None, "Brak", "Osoby", "Szkolenie BHP okresowe", None, None, None, None, None, None, None],
            [
                None,
                pesel,
                None,
                None,
                "Szkolenie BHP okresowe",
                None,
                None,
                None,
                "15.01.2026",
                None,
                None,
                None,
            ],
        ]
    )
    files = {"file": ("szkolenia.xlsx", data)}
    an = c.post("/api/trainings/import/analyze", files=files).json()
    mp = an["mapping"]
    assert {"number", "pesel", "last_name", "first_name", "type", "name", "department", "start_date",
            "completed_on", "valid_until", "mentor", "notes"} <= set(mp)  # fmt: skip
    form = {"mapping": json.dumps(mp)}
    pv = c.post("/api/trainings/import/preview", files=files, data=form).json()
    assert pv["summary"] == {"total": 5, "to_import": 2, "skipped": 1, "errors": 2}
    rows = {r["row"]: r for r in pv["rows"]}
    assert "Nowak Ola" in rows[2]["employee"] and "ważne do 15.01.2029" in rows[2]["dates"]
    assert rows[3]["training"] == "Operator prasy (Szkolenie stanowiskowe)"
    assert "nieznany rodzaj" in rows[4]["errors"][0] and "nie znaleziono" in rows[5]["errors"][0]
    assert rows[6]["status"] == "skip"

    assert c.post("/api/trainings/import/commit", files=files, data=form).status_code == 400
    r = c.post("/api/trainings/import/commit", files=files, data={**form, "skip_errors": "true"})
    assert r.json() == {"imported": 2, "skipped": 1, "errors": 2}
    tb = c.get(f"/api/employees/{b['id']}/trainings").json()[0]
    assert (
        tb["name"],
        tb["department_id"],
        tb["standard_days"],
        tb["mentor_id"],
        tb["program_id"] is not None,
    ) == ("Operator prasy", dep, 10, m["id"], True)
    assert c.get(f"/api/employees/{a['id']}/trainings").json()[0]["notes"] == "grupa A"
    # drugi raz – wszystko już jest
    again = c.post("/api/trainings/import/preview", files=files, data=form).json()
    assert again["summary"]["to_import"] == 0
    with SessionLocal() as db:
        assert (
            db.scalar(select(AuditLog).where(AuditLog.action == "trainings_imported")).details["imported"]
            == 2
        )


def test_batch_training(admin_client, make_user):
    c = admin_client
    a, b = _emp(c), _emp(c, "Jan", "Kowal")
    bhp = _types(c)["Szkolenie BHP okresowe"]["id"]
    r = c.post(
        "/api/trainings/batch",
        json={"employee_ids": [a["id"], b["id"]], "training": {"type_id": bhp, "completed_on": "2026-02-01"}},
    )
    assert r.status_code == 201 and r.json() == {"created": 2}
    assert c.get(f"/api/employees/{b['id']}/trainings").json()[0]["valid_until"] == "2029-02-01"
    # wszystko albo nic: błąd u jednej osoby nic nie zapisuje
    pos = _types(c)["Szkolenie stanowiskowe"]["id"]
    bad = {"type_id": pos, "name": "X", "mentor_id": a["id"]}
    r = c.post("/api/trainings/batch", json={"employee_ids": [b["id"], a["id"]], "training": bad})
    assert r.status_code == 400 and r.json()["detail"].startswith("Nowak Ola:")
    assert len(c.get(f"/api/employees/{b['id']}/trainings").json()) == 1
