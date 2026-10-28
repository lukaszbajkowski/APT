from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import cli, mailer
from app.db import SessionLocal
from app.main import app
from app.models import Department, Role, User, UserScope
from app.routers.trainings import add_months
from tests.conftest import login, make_pesel
from tests.test_documents import doc_text, simple_docx, upload

PDF = b"%PDF-1.4 test"


def _types(c):
    return {t["name"]: t for t in c.get("/api/training-types").json()}


def _emp(c, first="Ola", last="Nowak", **kw):
    return c.post("/api/employees", json={"first_name": first, "last_name": last, **kw}).json()


def test_add_months():
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert add_months(date(2026, 10, 25), 36) == date(2029, 10, 25)


def test_seeded_types_and_general_training(admin_client):
    c = admin_client
    types = _types(c)
    assert {"Szkolenie BHP okresowe", "Szkolenie stanowiskowe"} <= set(types)
    bhp = types["Szkolenie BHP okresowe"]
    assert bhp["validity_months"] == 36 and bhp["kind"] == "general"
    e = _emp(c)
    r = c.post(
        f"/api/employees/{e['id']}/trainings",
        json={"type_id": bhp["id"], "completed_on": "2026-01-15", "notes": " grupa A "},
    )
    assert r.status_code == 201, r.text
    tr = r.json()
    assert tr["valid_until"] == "2029-01-15" and tr["notes"] == "grupa A" and tr["status"] == "valid"
    # pola stanowiskowe są ignorowane dla zwykłego szkolenia
    r = c.put(
        f"/api/trainings/{tr['id']}",
        json={
            "type_id": bhp["id"],
            "completed_on": "2026-01-15",
            "valid_until": "2026-02-01",
            "mentor_id": 5,
        },
    )
    assert r.json()["valid_until"] == "2026-02-01" and r.json()["mentor_id"] is None
    bad = c.put(
        f"/api/trainings/{tr['id']}",
        json={"type_id": bhp["id"], "completed_on": "2026-01-15", "valid_until": "2025-01-01"},
    )
    assert bad.status_code == 400


def test_position_training_and_document(admin_client):
    c = admin_client
    with SessionLocal() as db:
        db.add(Department(name="Montaż"))
        db.commit()
        dep = db.scalar(select(Department.id))
    e = _emp(c)
    mentor = _emp(c, "Jan", "Opiekun")
    t = upload(
        c,
        simple_docx(
            "{{ nazwisko_imie }} / {{ szkolenie_nazwa }} / {{ szkolenie_opiekun }}",
            "{{ szkolenie_data_rozpoczecia }}-{{ szkolenie_data_zakonczenia }} {{ szkolenie_czas_dni }} dni",
            "Stanowisko: {{ maszyna }}",
        ),
        "Karta szkolenia stanowiskowego",
    ).json()
    assert [f["key"] for f in t["fields"]] == ["maszyna"]  # zmienne szkolenie_* nie są polami formularza
    # pola formularza ustawia się w edytorze szablonu
    tf = [{**t["fields"][0], "label": "Maszyna", "required": True}]
    assert c.patch(f"/api/templates/{t['id']}", json={"fields": tf}).status_code == 200
    pos = _types(c)["Szkolenie stanowiskowe"]
    r = c.put(
        f"/api/training-types/{pos['id']}",
        json={"name": pos["name"], "kind": "position", "template_id": t["id"]},
    )
    assert r.status_code == 200, r.text
    assert [(f["key"], f["label"]) for f in r.json()["fields"]] == [("maszyna", "Maszyna")]

    # katalog szkoleń stanowiskowych
    prog = {"name": "Operator prasy", "department_id": dep, "standard_days": 10}
    p = c.post(f"/api/training-types/{pos['id']}/programs", json=prog)
    assert p.status_code == 201 and p.json()["department"] == "Montaż"
    assert c.post(f"/api/training-types/{pos['id']}/programs", json=prog).status_code == 409
    assert _types(c)["Szkolenie stanowiskowe"]["programs"][0]["name"] == "Operator prasy"
    pid = p.json()["id"]
    body = {
        "type_id": pos["id"],
        "program_id": p.json()["id"],
        "name": "Operator prasy",
        "department_id": dep,
        "start_date": "2026-03-01",
        "exam_date": "2026-03-10",
        "end_date": "2026-03-12",
        "mentor_id": mentor["id"],
        "standard_days": 10,
        "values": {"maszyna": "Prasa P-200"},
    }
    assert c.post(f"/api/employees/{e['id']}/trainings", json={**body, "values": {}}).status_code == 400
    wrong_order = {**body, "exam_date": "2026-02-01"}
    assert c.post(f"/api/employees/{e['id']}/trainings", json=wrong_order).status_code == 400
    assert (
        c.post(f"/api/employees/{e['id']}/trainings", json={**body, "mentor_id": e["id"]}).status_code == 400
    )
    # opiekun musi mieć uprawnienie do tej pozycji katalogu
    r = c.post(f"/api/employees/{e['id']}/trainings", json=body)
    assert r.status_code == 400 and "uprawnień" in r.json()["detail"]
    m = c.put(f"/api/training-programs/{pid}/mentors", json={"ids": [mentor["id"]]})
    assert m.json()["mentors"] == [{"id": mentor["id"], "name": "Opiekun Jan", "active": True}]
    mp = c.get(f"/api/employees/{mentor['id']}/mentor-programs").json()
    assert [(x["name"], x["department"]) for x in mp] == [("Operator prasy", "Montaż")]
    tr = c.post(f"/api/employees/{e['id']}/trainings", json=body).json()
    assert tr["program_id"] == p.json()["id"]
    assert tr["mentor_name"] == "Opiekun Jan" and tr["completed_on"] == "2026-03-12" and tr["can_generate"]

    d = c.post(f"/api/trainings/{tr['id']}/document")
    assert d.status_code == 201, d.text
    docx = c.get(f"/api/documents/{d.json()['id']}/download", params={"format": "docx"}).content
    text = doc_text(docx)
    assert "Nowak Ola / Operator prasy / Jan Opiekun" in text
    assert "01.03.2026-12.03.2026 10 dni" in text and "Prasa P-200" in text


def test_scan_and_permissions(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    e = _emp(client, agency_id=None)
    t = _types(client)["Szkolenie BHP wstępne"]
    tr = client.post(f"/api/employees/{e['id']}/trainings", json={"type_id": t["id"]}).json()
    assert (
        client.post(f"/api/trainings/{tr['id']}/scan", files={"file": ("a.txt", b"hello")}).status_code == 400
    )
    r = client.post(f"/api/trainings/{tr['id']}/scan", files={"file": ("zaśw.pdf", PDF)})
    assert r.json()["has_scan"] and r.json()["scan_name"] == "zaśw.pdf"
    # na dysku skan jest zaszyfrowany, a przez API wraca jawny
    from pathlib import Path

    from app.config import get_settings

    on_disk = list((Path(get_settings().data_dir) / "trainings" / str(e["id"])).iterdir())
    assert on_disk and all(p.read_bytes().startswith(b"APTF") and PDF not in p.read_bytes() for p in on_disk)
    g = client.get(f"/api/trainings/{tr['id']}/scan")
    assert g.content == PDF and g.headers["content-type"] == "application/pdf"

    make_user("podglad", Role.viewer)
    v = TestClient(app)
    login(v, "podglad")
    assert len(v.get(f"/api/employees/{e['id']}/trainings").json()) == 1
    assert v.post(f"/api/employees/{e['id']}/trainings", json={"type_id": t["id"]}).status_code == 403
    assert v.get("/api/trainings/expiring").status_code == 403

    assert client.delete(f"/api/trainings/{tr['id']}").status_code == 204
    assert client.get(f"/api/employees/{e['id']}/trainings").json() == []


def test_expiring_latest_only_and_reminders(client, make_user, monkeypatch):
    hr = make_user("kadry", Role.hr)
    login(client, "kadry")
    with SessionLocal() as db:
        db.add(Department(name="Magazyn"))
        db.commit()
        dep = db.scalar(select(Department.id))
    a = _emp(client, department_id=dep)
    b = _emp(client, "Jan", "Kowal")
    sep = _types(client)["Uprawnienia SEP (elektryczne)"]["id"]
    today = date.today()

    def add(e, until):
        client.post(
            f"/api/employees/{e['id']}/trainings", json={"type_id": sep, "valid_until": until.isoformat()}
        )

    add(a, today + timedelta(days=10))
    add(b, today - timedelta(days=3))
    add(b, today + timedelta(days=400))  # nowsze uprawnienie – stare już nie alarmuje
    rows = client.get("/api/trainings/expiring").json()
    assert [(r["last_name"], r["status"]) for r in rows] == [("Nowak", "expiring")]
    add(a, today - timedelta(days=1))  # starsze niż bieżące – nie zmienia wyniku
    assert len(client.get("/api/trainings/expiring").json()) == 1

    mgr = make_user("kier", Role.manager)
    with SessionLocal() as db:
        db.get(User, hr.id).email = "kadry@example.com"
        db.get(User, mgr.id).email = "kier@example.com"
        db.add(UserScope(user_id=mgr.id, department_id=dep))
        db.commit()
    sent = []
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send_now", lambda to, msg: sent.append((to, msg)))
    assert cli.training_reminders() == 0
    assert {to for to, _ in sent} == {"kadry@example.com", "kier@example.com"}
    assert "Nowak Ola – Uprawnienia SEP (elektryczne): ważne do" in sent[0][1].items[0]

    # szkolenie stanowiskowe ponad standard trafia na początek listy
    pos = _types(client)["Szkolenie stanowiskowe"]["id"]
    late = {
        "type_id": pos,
        "name": "Spawacz",
        "start_date": (today - timedelta(days=9)).isoformat(),
        "standard_days": 5,
    }
    assert client.post(f"/api/employees/{a['id']}/trainings", json=late).status_code == 201
    sent.clear()
    cli.training_reminders()
    msg = dict(sent)["kadry@example.com"]
    assert msg.items[0].startswith("Ponad standard: Nowak Ola – Spawacz: dzień 9 z 5")
    assert "(2)" in msg.subject and "1 szkoleń stanowiskowych" in msg.paragraphs[1]


def test_delete_program_keeps_training(admin_client):
    c = admin_client
    pos = _types(c)["Szkolenie stanowiskowe"]
    p = c.post(
        f"/api/training-types/{pos['id']}/programs", json={"name": "Spawacz", "standard_days": 5}
    ).json()
    e = _emp(c)
    body = {"type_id": pos["id"], "program_id": p["id"], "name": "Spawacz", "standard_days": 5}
    tr = c.post(f"/api/employees/{e['id']}/trainings", json=body).json()
    assert c.delete(f"/api/training-programs/{p['id']}").status_code == 204
    after = c.get(f"/api/employees/{e['id']}/trainings").json()[0]
    assert after["id"] == tr["id"] and after["program_id"] is None and after["name"] == "Spawacz"


def test_position_status_in_progress(admin_client):
    c = admin_client
    pos = _types(c)["Szkolenie stanowiskowe"]["id"]
    e = _emp(c)
    today = date.today()

    def add(**kw):
        body = {
            "type_id": pos,
            "name": "Spawacz",
            **{k: v.isoformat() if isinstance(v, date) else v for k, v in kw.items()},
        }
        r = c.post(f"/api/employees/{e['id']}/trainings", json=body)
        assert r.status_code == 201, r.text
        return r.json()

    a = add(start_date=today - timedelta(days=3), standard_days=10)
    assert (a["status"], a["days"]) == ("in_progress", 3)
    b = add(start_date=today - timedelta(days=12), standard_days=10)
    assert b["status"] == "overdue"
    p = add(start_date=today + timedelta(days=5))
    assert p["status"] == "planned"
    done = add(start_date=today - timedelta(days=20), end_date=today - timedelta(days=2), standard_days=10)
    assert (done["status"], done["days"], done["completed_on"]) == (
        "completed",
        18,
        (today - timedelta(days=2)).isoformat(),
    )
    rows = c.get("/api/trainings/in-progress").json()
    assert [r["status"] for r in rows] == ["overdue", "in_progress", "planned"]


def test_mentor_programs_from_employee_side(admin_client):
    c = admin_client
    pos = _types(c)["Szkolenie stanowiskowe"]["id"]
    p1 = c.post(f"/api/training-types/{pos}/programs", json={"name": "A"}).json()
    p2 = c.post(f"/api/training-types/{pos}/programs", json={"name": "B"}).json()
    m = _emp(c, "Jan", "Opiekun")
    r = c.put(f"/api/employees/{m['id']}/mentor-programs", json={"ids": [p1["id"], p2["id"]]})
    assert [x["name"] for x in r.json()] == ["A", "B"]
    r = c.put(f"/api/employees/{m['id']}/mentor-programs", json={"ids": [p2["id"]]})
    assert [x["name"] for x in r.json()] == ["B"]
    progs = {x["name"]: x for x in _types(c)["Szkolenie stanowiskowe"]["programs"]}
    assert progs["A"]["mentors"] == [] and progs["B"]["mentors"][0]["id"] == m["id"]
    assert c.put(f"/api/employees/{m['id']}/mentor-programs", json={"ids": [99999]}).status_code == 400


def test_medical_reminders(admin_client, make_user, monkeypatch):
    from app import cli, mailer
    from app.models import MedicalExam

    hr = make_user("kadry2", Role.hr)
    e = _emp(admin_client, "Ola", "Badana", pesel=make_pesel(date(1990, 1, 1), "K"))
    today = date.today()
    with SessionLocal() as db:
        db.get(User, hr.id).email = "kadry2@example.com"
        db.add(
            MedicalExam(
                employee_id=e["id"], kind="okresowe", exam_date=today, valid_until=today + timedelta(days=10)
            )
        )
        db.commit()
    sent = []
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send_now", lambda to, msg: sent.append((to, msg)))
    assert cli.medical_reminders() == 0
    msg = dict(sent)["kadry2@example.com"]
    assert "Badana Ola" in msg.items[0] and "ważne do" in msg.items[0] and "(1)" in msg.subject
