"""Zabezpieczenia podpisu: tokeny w logach, limit żądań, pieczęć integralności, jeden podpis na link."""

import logging
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import hardening
from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import AuditLog
from app.templating import soffice_path
from tests.test_signatures import BORN, _doc, _sig_png, _token, outboxes  # noqa: F401

needs_office = pytest.mark.skipif(soffice_path() is None, reason="brak LibreOffice")


def test_tokens_are_masked_in_logs():
    secret = "AbC123_-token"
    assert secret not in hardening.mask_tokens(f"/api/sign/{secret}/page/0?v=klucz.123&x=1")
    assert hardening.mask_tokens("/api/sign/abc?v=k1&n=2") == "/api/sign/***?v=***&n=2"
    assert hardening.mask_tokens("/api/employees/5") == "/api/employees/5"  # reszta bez zmian
    rec = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:5", "GET", f"/api/sign/{secret}", "1.1", 200), None,
    )  # fmt: skip
    assert hardening.MaskTokensFilter().filter(rec)
    assert secret not in rec.getMessage() and "/api/sign/***" in rec.getMessage()


def test_filter_installed_on_uvicorn_access_logger():
    hardening.install_log_filter()
    assert any(isinstance(f, hardening.MaskTokensFilter) for f in logging.getLogger("uvicorn.access").filters)


def test_rate_limit_on_public_sign_endpoints(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "sign_rate_get", 5)
    monkeypatch.setattr(s, "sign_rate_post", 2)
    pub = TestClient(app)
    codes = [pub.get("/api/sign/nieistniejacy").status_code for _ in range(7)]
    assert codes[:5] == [404] * 5 and codes[5:] == [429, 429]
    assert pub.get("/api/sign/nieistniejacy").headers["retry-after"] == "60"
    # zapis liczony osobno
    post = [pub.post("/api/sign/x/verify", json={}).status_code for _ in range(3)]
    assert post == [404, 404, 429]
    # reszta API nie jest ograniczana
    assert all(pub.get("/api/health").status_code == 200 for _ in range(10))


@needs_office
def test_integrity_seal_detects_changed_file(admin_client, outboxes):  # noqa: F811
    c = admin_client
    mails, _ = outboxes
    emp, doc = _doc(c)
    c.post(
        f"/api/documents/{doc['id']}/signatures",
        json={"role": "pracownika", "channel": "email", "to": "a@b.pl"},
    )
    token = _token(mails[-1][2])
    pub = TestClient(app)
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    assert (
        pub.post(f"/api/sign/{token}", json={"image": _sig_png(), "view": view, "consent": True}).status_code
        == 200
    )

    st = c.get(f"/api/documents/{doc['id']}/signatures").json()
    assert st["integrity"] == "ok"
    with SessionLocal() as db:
        seals = list(db.scalars(select(AuditLog).where(AuditLog.action == "document_sealed")))
        assert len(seals) == 1
        d = seals[0].details
        assert (
            d["document_id"] == doc["id"]
            and len(d["signed_sha256"]) == 64
            and len(d["signature_png_sha256"]) == 64
        )
        signed = list(db.scalars(select(AuditLog).where(AuditLog.action == "document_signed")))[0].details
        assert signed["signature_png_sha256"] == d["signature_png_sha256"]

    # ktoś zmienia gotowy plik poza aplikacją
    path = Path(get_settings().data_dir) / "documents" / str(emp["id"]) / f"{doc['id']}_signed.pdf"
    path.write_bytes(path.read_bytes() + b"\n% zmiana")
    assert c.get(f"/api/documents/{doc['id']}/signatures").json()["integrity"] == "mismatch"

    # usunięcie podpisu = nowa pieczęć (stan po usunięciu jest zgodny z dziennikiem)
    rid = c.get(f"/api/documents/{doc['id']}/signatures").json()["roles"][0]["request_id"]
    r = c.post(f"/api/signatures/{rid}/remove", json={"reason": "test pieczęci"})
    assert r.status_code == 200 and r.json()["integrity"] == "ok"


@needs_office
def test_one_signature_per_link_even_when_parallel(admin_client, outboxes):  # noqa: F811
    c = admin_client
    mails, _ = outboxes
    _, doc = _doc(c)
    c.post(
        f"/api/documents/{doc['id']}/signatures",
        json={"role": "pracownika", "channel": "email", "to": "a@b.pl"},
    )
    token = _token(mails[-1][2])
    pub = TestClient(app)
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    body = {"image": _sig_png(), "view": view, "consent": True}
    barrier, codes = threading.Barrier(4), []

    def go() -> None:
        cl = TestClient(app)
        barrier.wait()
        codes.append(cl.post(f"/api/sign/{token}", json=body).status_code)

    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert codes.count(200) == 1, codes
    assert all(x in (404, 409, 410) for x in codes if x != 200), codes
    with SessionLocal() as db:
        from app.models import DocumentSignature

        n = db.scalars(select(DocumentSignature).where(DocumentSignature.status == "signed")).all()
        assert len(n) == 1
        assert len(list(db.scalars(select(AuditLog).where(AuditLog.action == "document_sealed")))) == 1
