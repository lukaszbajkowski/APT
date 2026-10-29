from app import mailer, push
from app.db import SessionLocal
from app.models import Employee
from tests.test_accounts import emp, hr  # noqa: F401, F811
from tests.test_me import me  # noqa: F401


def test_broadcast_flow(me, hr, emp):  # noqa: F811
    ag = hr.post("/api/agencies", json={"name": "Agencja Z"}).json()
    with SessionLocal() as db:
        db.get(Employee, emp).agency_id = ag["id"]
        db.commit()
    mailer.outbox, push.outbox = [], []
    assert hr.post("/api/broadcasts/preview", json={}).status_code == 400
    p = hr.post("/api/broadcasts/preview", json={"agency_id": ag["id"]}).json()
    assert p["total"] == 1 and p["with_account"] == 1
    r = hr.post(
        "/api/broadcasts",
        data={
            "subject": "Zmiana godzin",
            "body": "Od jutra zmiana zaczyna się o 6:00.",
            "agency_id": ag["id"],
        },
    )
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    assert r.json()["total"] == 1 and r.json()["read"] == 0
    # pracownik widzi komunikat i potwierdza
    assert me.get("/api/me/broadcasts/count").json() == {"unread": 1}
    mine = me.get("/api/me/broadcasts").json()
    assert mine[0]["subject"] == "Zmiana godzin" and mine[0]["read_at"] is None
    assert me.post(f"/api/me/broadcasts/{bid}/read").status_code == 204
    assert me.get("/api/me/broadcasts/count").json() == {"unread": 0}
    assert hr.get("/api/broadcasts").json()[0]["read"] == 1
    assert hr.get(f"/api/broadcasts/{bid}/recipients").json()[0]["read_at"] is not None
    # dokument do zapoznania się + przypomnienie
    d = hr.post(
        "/api/broadcasts",
        data={"kind": "document", "subject": "Regulamin", "body": "x" * 5000, "agency_id": ag["id"]},
    )
    assert d.status_code == 201 and d.json()["kind"] == "document"
    assert (
        hr.post(
            "/api/broadcasts", data={"subject": "a", "body": "x" * 2001, "agency_id": ag["id"]}
        ).status_code
        == 400
    )
    assert hr.post(f"/api/broadcasts/{d.json()['id']}/remind").json()["unread"] == 1
    # pracownik nie ma dostępu do funkcji kadr
    assert me.post("/api/broadcasts/preview", json={"everyone": True}).status_code == 403


def test_broadcast_files_and_archive(me, hr, emp):  # noqa: F811
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Broadcast, BroadcastRecipient
    from app.routers.broadcasts import archive_due

    pdf = b"%PDF-1.4\n%test\n"
    r = hr.post(
        "/api/broadcasts",
        data={"subject": "Regulamin", "body": "Zobacz załącznik.", "everyone": "true"},
        files=[("files", ("regulamin.pdf", pdf, "application/pdf"))],
    )
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    fid = r.json()["files"][0]["id"]
    assert r.json()["files"][0]["name"] == "regulamin.pdf"
    bad = hr.post(
        "/api/broadcasts",
        data={"subject": "x", "body": "y", "everyone": "true"},
        files=[("files", ("a.exe", b"MZ....", "application/octet-stream"))],
    )
    assert bad.status_code == 400
    # dokument jest widoczny w aplikacji (strony jako obrazy), bez pobierania pliku
    assert hr.get(f"/api/broadcasts/files/{fid}").status_code in (404, 405)
    assert me.get(f"/api/me/broadcasts/files/{fid}").status_code in (404, 405)
    mine = me.get("/api/me/broadcasts").json()[0]
    assert mine["files"][0]["id"] == fid
    assert me.get("/api/me/broadcasts/files/99999/preview").status_code == 404

    # archiwum: nieprzeczytany – po 7 dniach; przeczytany przez wszystkich – 2 dni po przeczytaniu
    now = datetime.now(UTC)
    with SessionLocal() as db:
        b = db.get(Broadcast, bid)
        assert archive_due(db, now) == 0
        b.created_at = now - timedelta(days=3)
        db.commit()
        assert archive_due(db, now) == 0
        rec = db.scalar(select(BroadcastRecipient).where(BroadcastRecipient.broadcast_id == bid))
        rec.read_at = now - timedelta(days=1)
        db.commit()
        assert archive_due(db, now) == 0  # przeczytane, ale minął tylko 1 dzień
        rec.read_at = now - timedelta(days=2, minutes=1)
        db.commit()
        assert archive_due(db, now) == 1
    assert [x["id"] for x in hr.get("/api/broadcasts?archived=true").json()] == [bid]
    assert bid not in [x["id"] for x in hr.get("/api/broadcasts").json()]
    assert all(x["id"] != bid for x in me.get("/api/me/broadcasts").json())


def test_manual_archive_and_document_only(me, hr, emp, minimal_pdf):  # noqa: F811
    r = hr.post(
        "/api/broadcasts",
        data={"subject": "Regulamin", "everyone": "true"},
        files=[("files", ("regulamin.pdf", minimal_pdf, "application/pdf"))],
    )
    assert r.status_code == 201, r.text  # sam dokument, bez treści
    bid, fid = r.json()["id"], r.json()["files"][0]["id"]
    assert hr.post("/api/broadcasts", data={"subject": "x", "everyone": "true"}).status_code == 400
    info = me.get(f"/api/me/broadcasts/files/{fid}/preview").json()
    assert info["pages"] == 1 and info["title"] == "regulamin.pdf"
    png = me.get(f"/api/me/broadcasts/files/{fid}/preview/page/0")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert me.get(f"/api/me/broadcasts/files/{fid}/preview/page/5").status_code == 404
    assert hr.get(f"/api/broadcasts/files/{fid}/preview").json()["pages"] == 1
    # ręczna archiwizacja i przywrócenie
    assert hr.post(f"/api/broadcasts/{bid}/archive").json() == {"archived": True}
    assert bid not in [x["id"] for x in hr.get("/api/broadcasts").json()]
    assert bid in [x["id"] for x in hr.get("/api/broadcasts?archived=true").json()]
    assert me.get("/api/me/broadcasts/count").json() == {"unread": 0}
    assert hr.post(f"/api/broadcasts/{bid}/archive?on=false").json() == {"archived": False}
    assert bid in [x["id"] for x in hr.get("/api/broadcasts").json()]


def test_employee_archive(me, hr, emp, minimal_pdf):  # noqa: F811
    r = hr.post("/api/broadcasts", data={"subject": "Info", "body": "Tekst", "everyone": "true"})
    bid = r.json()["id"]
    assert me.post(f"/api/me/broadcasts/{bid}/archive").status_code == 400  # jeszcze nieprzeczytany
    me.post(f"/api/me/broadcasts/{bid}/read")
    assert me.post(f"/api/me/broadcasts/{bid}/archive").json() == {"archived": True}
    assert me.get("/api/me/broadcasts").json() == []
    arch = me.get("/api/me/broadcasts?archived=true").json()
    assert [x["id"] for x in arch] == [bid] and arch[0]["own_archived"] is True
    assert me.post(f"/api/me/broadcasts/{bid}/archive?on=false").json() == {"archived": False}
    assert [x["id"] for x in me.get("/api/me/broadcasts").json()] == [bid]
