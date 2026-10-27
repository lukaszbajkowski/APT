import io
from datetime import date

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select, text

from app.db import SessionLocal, engine
from app.main import app
from app.models import Agency, AuditLog, Department, Employee, Position, Role, UserScope
from tests.conftest import login, make_pesel

PESEL_JAN = make_pesel(date(1990, 1, 1), "M", 111)
PESEL_ANNA = make_pesel(date(1995, 6, 30), "K", 222)


@pytest.fixture
def dicts():
    with SessionLocal() as db:
        a1, a2 = Agency(name="Agencja A"), Agency(name="Agencja B")
        d1, d2 = Department(name="Montaż"), Department(name="Magazyn")
        db.add_all([a1, a2, d1, d2])
        db.flush()
        p1 = Position(name="Operator", department_id=d1.id)
        p2 = Position(name="Magazynier", department_id=d2.id)
        db.add_all([p1, p2])
        db.commit()
        return {"a1": a1.id, "a2": a2.id, "d1": d1.id, "d2": d2.id, "p1": p1.id, "p2": p2.id}


@pytest.fixture
def hr(client, make_user):
    make_user("kadry", Role.hr)
    login(client, "kadry")
    return client


def create(c: TestClient, **kw):
    body = {"first_name": "Jan", "last_name": "Kowalski"} | kw
    return c.post("/api/employees", json=body)


def actions() -> list[str]:
    with SessionLocal() as db:
        return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))


# ---------- tworzenie, numer, PESEL ----------


def test_create_assigns_sequential_number(hr, dicts):
    r1 = create(hr, agency_id=dicts["a1"])
    r2 = create(hr, first_name="Anna", last_name="Nowak")
    assert r1.status_code == 201, r1.text
    assert r1.json()["number"] == 1
    assert r1.json()["number_display"] == "000001"
    assert r2.json()["number"] == 2
    assert r1.json()["agency"] == {"id": dicts["a1"], "name": "Agencja A"}
    assert r1.json()["status"] == "active"


def test_number_is_immutable(hr):
    e = create(hr).json()
    r = hr.patch(f"/api/employees/{e['id']}", json={"number": 999})
    assert r.status_code == 200
    assert r.json()["number"] == e["number"]


def test_pesel_fills_birth_date_and_sex_and_is_encrypted(hr):
    r = create(hr, pesel=f" {PESEL_JAN} ")
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["birth_date"] == "1990-01-01"
    assert e["sex"] == "M"
    assert e["has_pesel"] is True
    assert e["pesel_masked"] == "•••••••••" + PESEL_JAN[-2:]
    assert PESEL_JAN not in r.text

    with engine.connect() as conn:
        raw = conn.execute(text("SELECT pesel_enc::text, pesel_hash FROM employees")).one()
    assert PESEL_JAN not in raw[0]
    assert PESEL_JAN not in raw[1]


def test_pesel_validation(hr):
    assert create(hr, pesel="12345678901").status_code == 400
    r = create(hr, pesel=PESEL_JAN, birth_date="1991-01-01")
    assert r.status_code == 400
    assert "Data urodzenia" in r.json()["detail"]
    r = create(hr, pesel=PESEL_JAN, sex="K")
    assert r.status_code == 400
    assert "Płeć" in r.json()["detail"]


def test_pesel_duplicate_rejected(hr):
    first = create(hr, pesel=PESEL_JAN).json()
    r = create(hr, first_name="Inny", last_name="Człowiek", pesel=PESEL_JAN)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "pesel_duplicate"
    assert detail["employee"]["id"] == first["id"]


def test_possible_duplicate_requires_confirmation(hr):
    create(hr, birth_date="1990-01-01")
    r = create(hr, first_name="JAN", last_name="kowalski", birth_date="1990-01-01")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "possible_duplicate"
    r = create(hr, first_name="JAN", last_name="kowalski", birth_date="1990-01-01", confirm_duplicate=True)
    assert r.status_code == 201


def test_check_pesel_endpoint(hr):
    r = hr.post("/api/employees/check-pesel", json={"pesel": PESEL_ANNA})
    assert r.json() == {
        "valid": True,
        "message": None,
        "birth_date": "1995-06-30",
        "sex": "K",
        "duplicate_of": None,
    }
    e = create(hr, first_name="Anna", last_name="Nowak", pesel=PESEL_ANNA).json()
    r = hr.post("/api/employees/check-pesel", json={"pesel": PESEL_ANNA})
    assert r.json()["duplicate_of"]["id"] == e["id"]
    r = hr.post("/api/employees/check-pesel", params={"exclude_id": e["id"]}, json={"pesel": PESEL_ANNA})
    assert r.json()["duplicate_of"] is None
    assert hr.post("/api/employees/check-pesel", json={"pesel": "1"}).json()["valid"] is False


def test_reveal_pesel_is_audited(hr):
    e = create(hr, pesel=PESEL_JAN).json()
    r = hr.post(f"/api/employees/{e['id']}/pesel")
    assert r.json() == {"pesel": PESEL_JAN}
    assert actions().count("pesel_viewed") == 1


def test_update_pesel_and_clear(hr):
    e = create(hr, pesel=PESEL_JAN).json()
    other = make_pesel(date(1990, 1, 1), "M", 555)
    r = hr.patch(f"/api/employees/{e['id']}", json={"pesel": other})
    assert r.status_code == 200, r.text
    assert hr.post(f"/api/employees/{e['id']}/pesel").json()["pesel"] == other
    r = hr.patch(f"/api/employees/{e['id']}", json={"pesel": ""})
    assert r.json()["has_pesel"] is False
    # data urodzenia zostaje
    assert r.json()["birth_date"] == "1990-01-01"


def test_birth_date_change_must_match_pesel(hr):
    e = create(hr, pesel=PESEL_JAN).json()
    r = hr.patch(f"/api/employees/{e['id']}", json={"birth_date": "1980-01-01"})
    assert r.status_code == 400


def test_history_hides_personal_values(hr, dicts):
    e = create(hr, pesel=PESEL_JAN).json()
    hr.patch(
        f"/api/employees/{e['id']}",
        json={
            "last_name": "Nowak-Kowalski",
            "agency_id": dicts["a2"],
            "pesel": make_pesel(date(1990, 1, 1), "M", 9),
        },
    )
    hist = hr.get(f"/api/employees/{e['id']}/history").json()
    upd = next(h for h in hist if h["action"] == "employee_updated")
    changes = upd["details"]["changes"]
    assert changes["last_name"] == "zmienione"
    assert changes["pesel"] == "zmieniony"
    assert changes["agency_id"] == {"from": None, "to": dicts["a2"]}
    assert "Nowak" not in str(hist)
    assert PESEL_JAN not in str(hist)


# ---------- słowniki w kartotece ----------


def test_position_must_match_department(hr, dicts):
    r = create(hr, department_id=dicts["d1"], position_id=dicts["p2"])
    assert r.status_code == 400
    assert create(hr, department_id=dicts["d1"], position_id=dicts["p1"]).status_code == 201


def test_inactive_dictionary_item_cannot_be_assigned(hr, dicts):
    hr.patch(f"/api/agencies/{dicts['a1']}", json={"is_active": False})
    assert create(hr, agency_id=dicts["a1"]).status_code == 400


# ---------- lista, filtry ----------


def test_list_search_filters_and_paging(hr, dicts):
    create(hr, first_name="Jan", last_name="Kowalski", agency_id=dicts["a1"], department_id=dicts["d1"])
    create(hr, first_name="Anna", last_name="Nowak", agency_id=dicts["a2"], pesel=PESEL_ANNA)
    create(hr, first_name="Piotr", last_name="Zieliński", agency_id=dicts["a1"])

    def names(**params):
        r = hr.get("/api/employees", params=params)
        assert r.status_code == 200, r.text
        return [f"{e['last_name']}" for e in r.json()["items"]]

    assert names() == ["Kowalski", "Nowak", "Zieliński"]
    assert names(q="kow") == ["Kowalski"]
    assert names(q="anna nowak") == ["Nowak"]
    assert names(q="000003") == ["Zieliński"]
    assert names(agency_id=dicts["a1"]) == ["Kowalski", "Zieliński"]
    assert names(department_id=dicts["d1"]) == ["Kowalski"]
    assert names(missing="pesel") == ["Kowalski", "Zieliński"]
    assert names(missing=["pesel", "department"]) == ["Zieliński"]
    assert names(missing="photo") == ["Kowalski", "Nowak", "Zieliński"]
    assert names(sort="-number") == ["Zieliński", "Nowak", "Kowalski"]

    page = hr.get("/api/employees", params={"limit": 2, "offset": 2}).json()
    assert page["total"] == 3
    assert [e["last_name"] for e in page["items"]] == ["Zieliński"]


def test_terminate_and_restore(hr):
    e = create(hr, hire_date="2026-01-01").json()
    assert (
        hr.post(f"/api/employees/{e['id']}/terminate", json={"termination_date": "2025-12-01"}).status_code
        == 400
    )
    r = hr.post(f"/api/employees/{e['id']}/terminate", json={"termination_date": "2026-09-30"})
    assert r.json()["status"] == "terminated"
    assert hr.get("/api/employees").json()["total"] == 0
    assert hr.get("/api/employees", params={"status": "terminated"}).json()["total"] == 1
    assert hr.get("/api/employees", params={"status": "all"}).json()["total"] == 1
    r = hr.post(f"/api/employees/{e['id']}/restore")
    assert r.json()["status"] == "active"
    assert r.json()["termination_date"] is None
    assert actions()[-2:] == ["employee_terminated", "employee_restored"]


# ---------- uprawnienia ----------


def _employees(hr, dicts):
    a = create(
        hr,
        first_name="Jan",
        last_name="A",
        agency_id=dicts["a1"],
        department_id=dicts["d1"],
        pesel=PESEL_JAN,
        country_id=2,
    ).json()
    b = create(hr, first_name="Anna", last_name="B", agency_id=dicts["a2"], department_id=dicts["d1"]).json()
    c = create(hr, first_name="Ola", last_name="C", agency_id=dicts["a2"], department_id=dicts["d2"]).json()
    return a, b, c


def test_manager_sees_only_scope_and_no_personal_data(hr, make_user, dicts):
    a, b, c = _employees(hr, dicts)
    mgr = make_user("kierownik", Role.manager)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, department_id=dicts["d1"]))
        db.commit()

    m = TestClient(app)
    login(m, "kierownik")
    page = m.get("/api/employees").json()
    assert sorted(e["last_name"] for e in page["items"]) == ["A", "B"]
    item = next(e for e in page["items"] if e["last_name"] == "A")
    assert item["birth_date"] is None
    assert item["age"] is not None
    assert item["pesel_masked"] is None
    assert item["country"] == {"id": 2, "name": "Ukraina"}
    assert item["personal_data_visible"] is False

    assert m.get(f"/api/employees/{c['id']}").status_code == 404
    assert m.post(f"/api/employees/{a['id']}/pesel").status_code == 403
    assert m.get(f"/api/employees/{a['id']}/history").status_code == 403
    assert m.post("/api/employees", json={"first_name": "X", "last_name": "Y"}).status_code == 403

    # kierownik: tylko stanowisko i uwagi
    assert m.patch(f"/api/employees/{b['id']}", json={"last_name": "Zmiana"}).status_code == 403
    r = m.patch(f"/api/employees/{b['id']}", json={"position_id": dicts["p1"], "notes": "Brygadzista"})
    assert r.status_code == 200, r.text
    assert r.json()["position"]["name"] == "Operator"
    assert m.patch(f"/api/employees/{c['id']}", json={"notes": "x"}).status_code == 404


def test_manager_without_scope_sees_nothing(hr, make_user, dicts):
    _employees(hr, dicts)
    make_user("kierownik", Role.manager)
    m = TestClient(app)
    login(m, "kierownik")
    assert m.get("/api/employees").json()["total"] == 0


def test_viewer_reads_all_but_cannot_edit(hr, make_user, dicts):
    a, _, _ = _employees(hr, dicts)
    make_user("podglad", Role.viewer)
    v = TestClient(app)
    login(v, "podglad")
    assert v.get("/api/employees").json()["total"] == 3
    assert v.get(f"/api/employees/{a['id']}").json()["pesel_masked"] is None
    assert v.patch(f"/api/employees/{a['id']}", json={"notes": "x"}).status_code == 403
    assert v.post(f"/api/employees/{a['id']}/pesel").status_code == 403
    assert (
        v.post(f"/api/employees/{a['id']}/terminate", json={"termination_date": "2026-01-01"}).status_code
        == 403
    )


# ---------- zdjęcia ----------


def _jpeg(w: int, h: int, color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


def test_photo_upload_normalizes_and_serves(hr):
    e = create(hr).json()
    r = hr.put(f"/api/employees/{e['id']}/photo", files={"file": ("x.jpg", _jpeg(2000, 1500), "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["has_photo"] is True
    img = hr.get(f"/api/employees/{e['id']}/photo")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/jpeg"
    pic = Image.open(io.BytesIO(img.content))
    assert pic.size == (600, 800)
    assert len(img.content) <= 200 * 1024
    assert hr.get("/api/employees", params={"missing": "photo"}).json()["total"] == 0

    # podmiana usuwa stary plik
    with SessionLocal() as db:
        old = db.scalar(select(Employee).where(Employee.id == e["id"])).photo.file_name
    hr.put(f"/api/employees/{e['id']}/photo", files={"file": ("y.png", _jpeg(300, 400), "image/png")})
    from app import photos

    assert not photos.path_for(old).exists()

    assert hr.delete(f"/api/employees/{e['id']}/photo").status_code == 204
    assert hr.get(f"/api/employees/{e['id']}/photo").status_code == 404


def test_photo_rejects_non_images(hr):
    e = create(hr).json()
    r = hr.put(f"/api/employees/{e['id']}/photo", files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400
    r = hr.put(f"/api/employees/{e['id']}/photo", files={"file": ("x.jpg", _jpeg(50, 50), "image/jpeg")})
    assert r.status_code == 400


def test_ids_endpoint_respects_filters_and_scope(hr, make_user, dicts):
    a, b, c = _employees(hr, dicts)
    assert hr.get("/api/employees/ids").json() == [a["id"], b["id"], c["id"]]
    assert hr.get("/api/employees/ids", params={"agency_id": dicts["a2"]}).json() == [b["id"], c["id"]]
    mgr = make_user("kierownik", Role.manager)
    with SessionLocal() as db:
        db.add(UserScope(user_id=mgr.id, department_id=dicts["d1"]))
        db.commit()
    m = TestClient(app)
    login(m, "kierownik")
    assert m.get("/api/employees/ids").json() == [a["id"], b["id"]]


def test_lookup_by_card_number(hr, client, make_user):
    from app.models import AuditLog, UserScope

    e = hr.post("/api/employees", json={"first_name": "Jan", "last_name": "Skan"}).json()
    r = hr.get(f"/api/employees/by-number/{e['number_display']}")
    assert r.status_code == 200 and r.json()["id"] == e["id"]
    assert hr.get(f"/api/employees/by-number/{e['number']}").json()["id"] == e["id"]
    assert hr.get("/api/employees/by-number/999999").status_code == 404
    assert hr.get("/api/employees/by-number/abc").status_code == 400
    with SessionLocal() as db:
        assert db.scalar(select(AuditLog).where(AuditLog.action == "card_scanned")) is not None
    # kierownik bez dostępu do tego pracownika
    mgr = make_user("kier", Role.manager)
    with SessionLocal() as db:
        d = Department(name="Inny")
        db.add(d)
        db.flush()
        db.add(UserScope(user_id=mgr.id, department_id=d.id))
        db.commit()
    other = TestClient(client.app)
    login(other, "kier")
    assert other.get(f"/api/employees/by-number/{e['number_display']}").status_code == 404
