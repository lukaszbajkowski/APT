from datetime import date, timedelta

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Department, Position
from tests.test_trainings import _emp, _types


def _setup(c):
    with SessionLocal() as db:
        d = Department(name="Montaż")
        db.add(d)
        db.flush()
        db.add(Position(name="Operator", department_id=d.id))
        db.commit()
        dep = d.id
        pos_id = db.scalar(select(Position.id))
    types = _types(c)
    st, bhp = types["Szkolenie stanowiskowe"]["id"], types["Szkolenie BHP okresowe"]["id"]
    prog = c.post(f"/api/training-types/{st}/programs", json={"name": "Prasa", "department_id": dep}).json()
    return dep, pos_id, st, bhp, prog


def test_requirements_matrix_quality(admin_client):
    c = admin_client
    dep, pos_id, st, bhp, prog = _setup(c)
    r = c.put(
        f"/api/positions/{pos_id}/requirements",
        json={"items": [{"type_id": bhp}, {"type_id": st, "program_id": prog["id"]}]},
    )
    assert r.status_code == 200 and sorted(x["label"] for x in r.json()["requirements"]) == [
        "Prasa",
        "Szkolenie BHP okresowe",
    ]
    a = _emp(c, department_id=dep, position_id=pos_id)
    b = _emp(c, "Jan", "Kowal", department_id=dep, position_id=pos_id)
    today = date.today()
    c.post(f"/api/employees/{a['id']}/trainings", json={"type_id": bhp, "completed_on": today.isoformat()})
    # w trakcie szkolenia z katalogu (dopasowanie po pozycji)
    c.post(
        f"/api/employees/{a['id']}/trainings",
        json={
            "type_id": st,
            "program_id": prog["id"],
            "name": "Prasa",
            "start_date": (today - timedelta(days=2)).isoformat(),
        },
    )
    # wygasłe BHP u drugiej osoby
    c.post(f"/api/employees/{b['id']}/trainings", json={"type_id": bhp, "valid_until": "2025-01-01"})
    c.put(f"/api/training-programs/{prog['id']}/mentors", json={"ids": [b["id"]]})

    reqs = {x["label"]: x["state"] for x in c.get(f"/api/employees/{a['id']}/requirements").json()}
    assert reqs == {"Szkolenie BHP okresowe": "ok", "Prasa": "in_progress"}

    m = c.get("/api/trainings/matrix", params={"department_id": dep}).json()
    keys = {col["label"]: col["key"] for col in m["columns"]}
    assert set(keys) == {"Prasa", "Szkolenie BHP okresowe"}
    rows = {r["name"]: r for r in m["rows"]}
    assert rows["Nowak Ola"]["cells"][keys["Prasa"]]["state"] == "in_progress"
    kb = rows["Kowal Jan"]
    assert kb["cells"][keys["Szkolenie BHP okresowe"]] == {
        "state": "expired",
        "required": True,
        "mentor": False,
        "valid_until": "2025-01-01",
    }
    assert kb["cells"][keys["Prasa"]]["mentor"] is True and kb["problems"] == 2
    assert rows["Nowak Ola"]["problems"] == 0
    assert len(c.get("/api/trainings/matrix", params={"general": "true"}).json()["columns"]) > 2

    q = c.get("/api/quality").json()
    by = {r["last_name"]: r["missing"] for r in q["rows"]}
    assert "trainings" in by["Kowal"] and "trainings" not in by.get("Nowak", [])

    # usunięcie wymagań
    assert c.put(f"/api/positions/{pos_id}/requirements", json={"items": []}).json()["requirements"] == []
    assert c.get(f"/api/employees/{b['id']}/requirements").json() == []
