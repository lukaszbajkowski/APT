from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models import Department, Position, Role, UserScope
from tests.conftest import login, make_pesel
from tests.test_trainings import _emp, _types


def _deps():
    with SessionLocal() as db:
        a, b = Department(name="Montaż"), Department(name="Magazyn")
        db.add_all([a, b])
        db.flush()
        p = Position(name="Operator", department_id=a.id)
        db.add(p)
        db.commit()
        return a.id, b.id, p.id


def test_assignment_history_and_rehire(admin_client):
    c = admin_client
    mont, mag, pos = _deps()
    pesel = make_pesel(date(1990, 1, 1), "K")
    e = _emp(c, pesel=pesel, department_id=mont, hire_date="2024-01-10")
    c.patch(f"/api/employees/{e['id']}", json={"department_id": mag})
    c.patch(f"/api/employees/{e['id']}", json={"notes": "x"})  # bez zmiany przydziału
    tl = c.get(f"/api/employees/{e['id']}/timeline").json()
    assert [(a["department"], a["reason"]) for a in tl["assignments"]] == [
        ("Magazyn", "zmiana"),
        ("Montaż", "zatrudnienie"),
    ]
    # stary pracownik wpisany wstecz – bez checklisty wdrożenia
    assert c.get(f"/api/employees/{e['id']}/checklists").json()["onboarding"] == []

    c.post(f"/api/employees/{e['id']}/terminate", json={"termination_date": "2025-06-30"})
    off = c.get(f"/api/employees/{e['id']}/checklists").json()["offboarding"]
    assert off and off[0]["due_date"] == "2025-06-30" and off[0]["state"] == "overdue"

    chk = c.post("/api/employees/check-pesel", json={"pesel": pesel}).json()
    assert chk["duplicate_of"]["archived"] is True and chk["duplicate_of"]["termination_date"] == "2025-06-30"

    bad = c.post(f"/api/employees/{e['id']}/rehire", json={"hire_date": "2025-01-01"})
    assert bad.status_code == 400
    hire = (date.today() + timedelta(days=2)).isoformat()
    r = c.post(
        f"/api/employees/{e['id']}/rehire",
        json={"hire_date": hire, "department_id": mont, "position_id": pos},
    )
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["hire_date"] == hire
    tl = c.get(f"/api/employees/{e['id']}/timeline").json()
    assert [(p["hire_date"], p["termination_date"], p["current"]) for p in tl["periods"]] == [
        (hire, None, True),
        ("2024-01-10", "2025-06-30", False),
    ]
    assert (
        tl["assignments"][0]["reason"] == "ponowne zatrudnienie"
        and tl["assignments"][0]["position"] == "Operator"
    )
    cl = c.get(f"/api/employees/{e['id']}/checklists").json()
    assert cl["offboarding"] == [] and len(cl["onboarding"]) >= 5
    assert c.post(f"/api/employees/{e['id']}/rehire", json={"hire_date": hire}).status_code == 400


def test_checklists_auto_tasks_and_permissions(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    mont, _, _ = _deps()
    e = _emp(client, department_id=mont, hire_date=date.today().isoformat())
    items = {i["label"]: i for i in client.get(f"/api/employees/{e['id']}/checklists").json()["onboarding"]}
    assert items["Szkolenie BHP wstępne"]["state"] == "open"
    # automatyczne odhaczenie po wpisaniu szkolenia
    bhp = _types(client)["Szkolenie BHP wstępne"]["id"]
    client.post(f"/api/employees/{e['id']}/trainings", json={"type_id": bhp})
    items = {i["label"]: i for i in client.get(f"/api/employees/{e['id']}/checklists").json()["onboarding"]}
    assert items["Szkolenie BHP wstępne"]["state"] == "auto"
    med = items["Deklaracja Medicover"]
    r = client.patch(f"/api/checklist-items/{med['id']}", json={"done": True, "note": " wysłano "})
    assert (
        r.json()["state"] == "done"
        and r.json()["done_by_name"] == "Kadry Testowy"
        and r.json()["note"] == "wysłano"
    )

    tasks = client.get("/api/tasks").json()
    labels = {t["label"] for t in tasks}
    assert "Deklaracja Medicover" not in labels and "Szkolenie BHP wstępne" not in labels
    assert "Rozpoczęcie szkolenia stanowiskowego" in labels

    mgr = make_user("kier", Role.manager)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, department_id=mont))
        db.commit()
    m = TestClient(app)
    login(m, "kier")
    mine = m.get("/api/tasks", params={"mine": "true"}).json()
    assert {t["responsible"] for t in mine} == {"manager"}
    hr_item = items["Zdjęcie do karty"]
    assert m.patch(f"/api/checklist-items/{hr_item['id']}", json={"done": True}).status_code == 403
    assert m.patch(f"/api/checklist-items/{mine[0]['id']}", json={"done": True}).status_code == 200


def test_checklist_templates(admin_client):
    c = admin_client
    t = c.get("/api/checklist-templates").json()
    assert any(o["value"] == "photo" for o in t["auto_options"])
    r = c.put(
        "/api/checklist-templates/onboarding",
        json={
            "items": [
                {"label": "Umowa", "responsible": "hr", "due_days": 0},
                {"label": "Szafka", "responsible": "manager", "due_days": 2, "auto": None},
            ]
        },
    )
    assert [i["label"] for i in r.json()["onboarding"]] == ["Umowa", "Szafka"]
    assert (
        c.put(
            "/api/checklist-templates/onboarding", json={"items": [{"label": "X", "auto": "zly"}]}
        ).status_code
        == 400
    )
    e = _emp(c)  # bez daty zatrudnienia – checklista od dziś
    items = c.get(f"/api/employees/{e['id']}/checklists").json()["onboarding"]
    assert [(i["label"], i["due_date"]) for i in items] == [
        ("Umowa", date.today().isoformat()),
        ("Szafka", (date.today() + timedelta(days=2)).isoformat()),
    ]
    with SessionLocal() as db:
        assert db.scalar(select(Position)) is None


def test_checklist_scope_sync_and_apply(admin_client):
    from app.models import Agency

    c = admin_client
    mont, mag, _ = _deps()
    with SessionLocal() as db:
        ag = Agency(name="WorkForce")
        db.add(ag)
        db.commit()
        ag_id = ag.id
    tpl = c.get("/api/checklist-templates").json()["onboarding"]
    items = [{**t} for t in tpl[:2]]  # dwie wspólne pozycje (z id – zachowane powiązania)
    items.append(
        {"label": "Odzież ochronna", "responsible": "manager", "due_days": 1, "department_ids": [mont]}
    )
    items.append({"label": "Umowa agencji", "responsible": "hr", "due_days": 3, "agency_ids": [ag_id]})
    r = c.put("/api/checklist-templates/onboarding", json={"items": items})
    assert r.status_code == 200, r.text
    saved = r.json()["onboarding"]
    assert [t["id"] for t in saved[:2]] == [t["id"] for t in tpl[:2]]  # id zachowane
    bad = c.put("/api/checklist-templates/onboarding", json={"items": [{"label": "X", "agency_ids": [9999]}]})
    assert bad.status_code == 400

    today = date.today()
    a = _emp(c, department_id=mont, hire_date=today.isoformat())
    b = _emp(c, "Jan", "Kowal", department_id=mag, agency_id=ag_id, hire_date=today.isoformat())
    la = [i["label"] for i in c.get(f"/api/employees/{a['id']}/checklists").json()["onboarding"]]
    lb = [i["label"] for i in c.get(f"/api/employees/{b['id']}/checklists").json()["onboarding"]]
    assert "Odzież ochronna" in la and "Umowa agencji" not in la
    assert "Odzież ochronna" not in lb and "Umowa agencji" in lb

    # przeniesienie do Montażu dodaje pozycję wydziału
    c.patch(f"/api/employees/{b['id']}", json={"department_id": mont})
    lb = {i["label"]: i for i in c.get(f"/api/employees/{b['id']}/checklists").json()["onboarding"]}
    assert lb["Odzież ochronna"]["due_date"] == (today + timedelta(days=1)).isoformat()

    # zmiana terminu w szablonie + zastosowanie do trwających
    items = c.get("/api/checklist-templates").json()["onboarding"]
    for t in items:
        if t["label"] == "Umowa agencji":
            t["due_days"] = 10
    c.put("/api/checklist-templates/onboarding", json={"items": items})
    res = c.post("/api/checklist-templates/onboarding/apply").json()
    assert res["people"] == 2
    lb = {i["label"]: i for i in c.get(f"/api/employees/{b['id']}/checklists").json()["onboarding"]}
    assert lb["Umowa agencji"]["due_date"] == (today + timedelta(days=10)).isoformat()

    # termin u jednej osoby
    new_due = (today + timedelta(days=20)).isoformat()
    r = c.patch(f"/api/checklist-items/{lb['Umowa agencji']['id']}", json={"due_date": new_due})
    assert r.json()["due_date"] == new_due


def test_assignment_effective_date(admin_client):
    c = admin_client
    mont, mag, _ = _deps()
    e = _emp(c, department_id=mont, hire_date="2026-01-01")
    today = date.today()
    future = (today + timedelta(days=3)).isoformat()
    r = c.patch(f"/api/employees/{e['id']}", json={"department_id": mag, "effective_date": "2025-12-01"})
    assert r.status_code == 400 and "zatrudnienia" in r.json()["detail"]
    r = c.patch(f"/api/employees/{e['id']}", json={"department_id": mag, "effective_date": "2026-03-01"})
    assert r.status_code == 200
    tl = c.get(f"/api/employees/{e['id']}/timeline").json()["assignments"]
    assert [(a["valid_from"], a["department"]) for a in tl] == [
        ("2026-03-01", "Magazyn"),
        ("2026-01-01", "Montaż"),
    ]
    # wcześniej niż poprzednia zmiana – odrzucone
    r = c.patch(f"/api/employees/{e['id']}", json={"department_id": mont, "effective_date": "2026-02-01"})
    assert r.status_code == 400 and "poprzednia" in r.json()["detail"]
    # data ignorowana, gdy nie zmienia się przydział
    assert (
        c.patch(f"/api/employees/{e['id']}", json={"notes": "x", "effective_date": future}).status_code == 200
    )


def test_planned_change(admin_client):
    from app import lifecycle

    c = admin_client
    mont, mag, pos = _deps()
    e = _emp(c, department_id=mont, hire_date="2026-01-01")
    today = date.today()
    later = today + timedelta(days=5)
    r = c.patch(
        f"/api/employees/{e['id']}",
        json={
            "department_id": mag,
            "position_id": None,
            "notes": "od razu",
            "effective_date": later.isoformat(),
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert (
        body["department"]["name"] == "Montaż" and body["notes"] == "od razu"
    )  # przydział jeszcze bez zmian
    planned = c.get(f"/api/employees/{e['id']}/planned-changes").json()
    assert [(p["effective_date"], p["department"], p["fields"]) for p in planned] == [
        (later.isoformat(), "Magazyn", ["department_id"])
    ]
    # kolejna zmiana nie może być wcześniejsza niż zaplanowana
    early = (today + timedelta(days=2)).isoformat()
    assert (
        c.patch(f"/api/employees/{e['id']}", json={"position_id": pos, "effective_date": early}).status_code
        == 400
    )
    ev = [x for x in c.get("/api/dashboard/upcoming").json() if x["kind"] == "transfer"]
    assert ev and ev[0]["title"] == "Przeniesienie: Magazyn"

    # dzień przed – nic; w dniu zmiany – wprowadzona
    with SessionLocal() as db:
        assert lifecycle.apply_due_changes(db, later - timedelta(days=1)) == 0
        assert lifecycle.apply_due_changes(db, later) == 1
    assert c.get(f"/api/employees/{e['id']}").json()["department"]["name"] == "Magazyn"
    tl = c.get(f"/api/employees/{e['id']}/timeline").json()["assignments"]
    assert (tl[0]["valid_from"], tl[0]["reason"]) == (later.isoformat(), "zaplanowana zmiana")
    assert c.get(f"/api/employees/{e['id']}/planned-changes").json() == []

    # anulowanie i anulowanie przy zwolnieniu
    c.patch(
        f"/api/employees/{e['id']}",
        json={"department_id": mont, "effective_date": (later + timedelta(days=1)).isoformat()},
    )
    pid = c.get(f"/api/employees/{e['id']}/planned-changes").json()[0]["id"]
    assert c.delete(f"/api/planned-changes/{pid}").status_code == 204
    c.patch(
        f"/api/employees/{e['id']}",
        json={"department_id": mont, "effective_date": (later + timedelta(days=2)).isoformat()},
    )
    c.post(f"/api/employees/{e['id']}/terminate", json={"termination_date": today.isoformat()})
    assert c.get(f"/api/employees/{e['id']}/planned-changes").json() == []
