"""Zaufany znacznik czasu (RFC 3161) – testy na lokalnej, sztucznej usłudze czasu."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from asn1crypto import keys as akeys
from asn1crypto import tsp
from asn1crypto import x509 as ax509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from fastapi.testclient import TestClient
from pyhanko.sign.timestamps import DummyTimeStamper
from sqlalchemy import select

from app import timestamp as tsa
from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import AuditLog
from app.templating import soffice_path
from tests.test_signatures import (  # noqa: F401
    BORN,
    _doc,
    _sig_png,
    _token,
    outboxes,
)

needs_office = pytest.mark.skipif(soffice_path() is None, reason="Brak LibreOffice")


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _tsa():
    now = datetime.now(UTC)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = (
        x509.CertificateBuilder()
        .subject_name(_name("Testowa usługa czasu"))
        .issuer_name(_name("Testowa usługa czasu"))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.TIME_STAMPING]), critical=True)
        .sign(key, hashes.SHA256())
    )
    der = cert.public_bytes(serialization.Encoding.DER)
    pkcs8 = key.private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    return der, DummyTimeStamper(
        tsa_cert=ax509.Certificate.load(der), tsa_key=akeys.PrivateKeyInfo.load(pkcs8)
    )


def _post_from(dummy: DummyTimeStamper):
    def post(url: str, body: bytes, timeout: float) -> bytes:
        req = tsp.TimeStampReq.load(body)
        return asyncio.run(dummy.async_request_tsa_response(req)).dump()

    return post


DIGEST = "ab" * 32


def test_valid_response_is_accepted():
    der, dummy = _tsa()
    get_settings().tsa_url = "https://tsa.example/tsr"
    res = tsa.stamp_digest(DIGEST, post=_post_from(dummy), roots=[der])
    assert res["trusted"] is True and res["tsa"] == "Testowa usługa czasu" and res["token"]
    assert abs(datetime.fromisoformat(res["gen_time"]) - datetime.now(UTC)) < timedelta(minutes=1)
    # bez znanych urzędów sprawdzamy tylko podpis tokenu
    assert tsa.stamp_digest(DIGEST, post=_post_from(dummy), roots=None)["trusted"] is None


def test_wrong_imprint_nonce_time_or_trust_are_rejected():
    der, dummy = _tsa()
    get_settings().tsa_url = "https://tsa.example/tsr"
    good = _post_from(dummy)

    def other_digest(url, body, timeout):  # usługa podpisuje inny skrót
        req = tsp.TimeStampReq.load(body)
        req["message_imprint"]["hashed_message"] = bytes.fromhex("cd" * 32)
        return asyncio.run(dummy.async_request_tsa_response(req)).dump()

    def other_nonce(url, body, timeout):
        req = tsp.TimeStampReq.load(body)
        req["nonce"] = 12345
        return asyncio.run(dummy.async_request_tsa_response(req)).dump()

    with pytest.raises(tsa.TimestampError, match="innego skrótu"):
        tsa.stamp_digest(DIGEST, post=other_digest, roots=[der])
    with pytest.raises(tsa.TimestampError, match="nonce"):
        tsa.stamp_digest(DIGEST, post=other_nonce, roots=[der])
    old = DummyTimeStamper(
        tsa_cert=dummy.tsa_cert, tsa_key=dummy.tsa_key, fixed_dt=datetime.now(UTC) - timedelta(hours=2)
    )
    with pytest.raises(tsa.TimestampError, match="odbiega"):
        tsa.stamp_digest(DIGEST, post=_post_from(old), roots=[der])
    # obcy urząd: podpis usługi jest poprawny, ale łańcuch nie prowadzi do zaufanego urzędu
    other_der, _ = _tsa()
    assert tsa.stamp_digest(DIGEST, post=good, roots=[other_der])["trusted"] is False
    with pytest.raises(tsa.TimestampError, match="Brak połączenia"):
        tsa.stamp_digest(DIGEST, post=lambda u, b, t: (_ for _ in ()).throw(OSError("x")), roots=None)
    with pytest.raises(tsa.TimestampError, match="Nieprawidłowa"):
        tsa.stamp_digest(DIGEST, post=lambda u, b, t: b"smieci", roots=None)


@needs_office
def test_signed_document_gets_timestamp_in_log(admin_client, outboxes, monkeypatch):  # noqa: F811
    c = admin_client
    mails, _ = outboxes
    _, doc = _doc(c)
    der, dummy = _tsa()
    settings = get_settings()
    monkeypatch.setattr(settings, "tsa_url", "https://tsa.example/tsr")
    monkeypatch.setattr(tsa, "schedule", lambda doc_id: None)  # bez wątku w tle; wołamy ręcznie
    monkeypatch.setattr(tsa, "trust_roots", lambda allow_fetch=True: [der])
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
    assert st["timestamp_enabled"] is True and st["timestamp"] is None  # jeszcze bez znacznika
    assert c.get(f"/api/documents/{doc['id']}/timestamp").status_code == 404

    done, failed = tsa.stamp_pending(post=_post_from(dummy))
    assert (done, failed) == (1, 0)
    assert tsa.stamp_pending(post=_post_from(dummy)) == (0, 0)  # drugi raz nic nie dodaje
    st = c.get(f"/api/documents/{doc['id']}/signatures").json()
    assert st["timestamp"]["tsa"] == "Testowa usługa czasu" and st["timestamp"]["trusted"] is True
    with SessionLocal() as db:
        entry = db.scalars(select(AuditLog).where(AuditLog.action == "document_timestamped")).one()
        seal = list(db.scalars(select(AuditLog).where(AuditLog.action == "document_sealed")))[-1]
        assert entry.details["signed_sha256"] == seal.details["signed_sha256"]
        entry_hash = entry.details["signed_sha256"]
    tok = c.get(f"/api/documents/{doc['id']}/timestamp")
    assert tok.status_code == 200 and tok.headers["content-type"] == "application/timestamp-reply"
    from asn1crypto import cms

    info = cms.ContentInfo.load(tok.content)["content"]["encap_content_info"]["content"].parsed
    assert info["message_imprint"]["hashed_message"].native.hex() == entry_hash
