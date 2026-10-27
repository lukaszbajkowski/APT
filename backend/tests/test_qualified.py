"""Weryfikacja podpisów kwalifikowanych (PAdES) i potwierdzenie blokadą urządzenia (WebAuthn)."""

import base64
import hashlib
import io
import json
import os
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import cbor2
import pytest
from asn1crypto import keys as akeys
from asn1crypto import x509 as ax509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import signers
from pyhanko_certvalidator.registry import SimpleCertificateStore
from pypdf import PdfReader, PdfWriter

from app import qualified, trustlist
from app.config import get_settings
from app.main import app
from app.templating import soffice_path
from tests.test_signatures import BORN, _doc, _sig_png, outboxes  # noqa: F401

pytestmark = pytest.mark.skipif(soffice_path() is None, reason="brak LibreOffice")

# QCStatements: SEQUENCE { SEQUENCE { OID 0.4.0.1862.1.1 (QcCompliance) } }
QC_DER = bytes.fromhex("300a3008060604008e460101")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _pki(qc: bool):
    now = datetime.now(UTC)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca = (
        x509.CertificateBuilder()
        .subject_name(_name("Testowy Kwalifikowany CA"))
        .issuer_name(_name("Testowy Kwalifikowany CA"))
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(True, False, False, False, False, True, True, False, False), critical=True
        )
        .sign(ca_key, hashes.SHA256())
    )
    key = ec.generate_private_key(ec.SECP256R1())
    b = (
        x509.CertificateBuilder()
        .subject_name(_name("Jan Podpisujący"))
        .issuer_name(ca.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(
            x509.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True
        )
    )
    if qc:
        b = b.add_extension(
            x509.UnrecognizedExtension(x509.ObjectIdentifier("1.3.6.1.5.5.7.1.3"), QC_DER), critical=False
        )
    leaf = b.sign(ca_key, hashes.SHA256())
    return ca, leaf, key


def _sign_pdf(pdf: bytes, qc: bool = True):
    ca, leaf, key = _pki(qc)
    a_ca = ax509.Certificate.load(ca.public_bytes(serialization.Encoding.DER))
    a_leaf = ax509.Certificate.load(leaf.public_bytes(serialization.Encoding.DER))
    a_key = akeys.PrivateKeyInfo.load(
        key.private_bytes(
            serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    signer = signers.SimpleSigner(
        signing_cert=a_leaf, signing_key=a_key, cert_registry=SimpleCertificateStore.from_certs([a_ca])
    )
    out = signers.sign_pdf(
        IncrementalPdfFileWriter(io.BytesIO(pdf)),
        signers.PdfSignatureMetadata(field_name="Sig1"),
        signer=signer,
    )
    return out.getvalue(), ca.public_bytes(serialization.Encoding.DER)


def _again(c, emp, doc) -> dict:
    """Kolejny dokument z tego samego szablonu (szablon o tej nazwie można wgrać tylko raz)."""
    r = c.post(
        f"/api/employees/{emp['id']}/documents", json={"template_id": doc["template_id"], "values": {}}
    )
    assert r.status_code == 201, r.text
    return r.json()


def _upload(c, doc, signed: bytes):
    link = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika"}).json()["link"]
    token = link.rsplit("/", 1)[1]
    pub = TestClient(app)
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    return pub.post(
        f"/api/sign/{token}/trusted", files={"file": ("podpisany.pdf", signed)}, data={"view": view}
    )


def test_qualified_signature_is_verified(admin_client, monkeypatch, outboxes):  # noqa: F811
    c = admin_client
    _, doc = _doc(c)
    original = c.get(f"/api/documents/{doc['id']}/download?format=pdf").content
    signed, ca_der = _sign_pdf(original, qc=True)
    monkeypatch.setattr(trustlist, "load_roots", lambda allow_fetch=True: [ca_der])
    r = _upload(c, doc, signed)
    assert r.status_code == 200, r.text
    check = r.json()["check"]
    assert check["level"] == "qualified" and check["trusted"] is True and check["qc_marked"] is True
    assert check["signer"] == "Jan Podpisujący"
    st = c.get(f"/api/documents/{doc['id']}/signatures").json()["roles"][0]
    assert st["check"]["level"] == "qualified" and st["method"] == "zaufany"
    # strona potwierdzenia w podglądzie zawiera wynik weryfikacji
    pages = len(PdfReader(io.BytesIO(original)).pages)
    assert c.get(f"/api/documents/{doc['id']}/preview").json()["pages"] == pages + 1
    assert c.get(f"/api/documents/{doc['id']}/signed").content == signed


def test_qualified_needs_trusted_issuer_and_qc_mark(admin_client, monkeypatch, outboxes):  # noqa: F811
    c = admin_client
    emp, doc = _doc(c)
    original = c.get(f"/api/documents/{doc['id']}/download?format=pdf").content
    # certyfikat z oznaczeniem, ale wystawcy nie ma na liście zaufania → tylko „ważny”
    signed, _ = _sign_pdf(original, qc=True)
    monkeypatch.setattr(
        trustlist,
        "load_roots",
        lambda allow_fetch=True: [_pki(True)[0].public_bytes(serialization.Encoding.DER)],
    )
    r = _upload(c, doc, signed)
    assert r.status_code == 200, r.text
    assert r.json()["check"]["level"] == "valid" and r.json()["check"]["trusted"] is False
    # brak listy zaufania (offline) → łańcuch nie sprawdzony
    doc2 = _again(c, emp, doc)
    original2 = c.get(f"/api/documents/{doc2['id']}/download?format=pdf").content
    signed2, _ = _sign_pdf(original2, qc=True)
    monkeypatch.setattr(trustlist, "load_roots", lambda allow_fetch=True: None)
    r = _upload(c, doc2, signed2)
    assert r.json()["check"]["level"] == "valid" and r.json()["check"]["trusted"] is None
    # zwykły certyfikat (bez QcCompliance), nawet z zaufanym urzędem → nie kwalifikowany
    doc3 = _again(c, emp, doc)
    original3 = c.get(f"/api/documents/{doc3['id']}/download?format=pdf").content
    signed3, ca3 = _sign_pdf(original3, qc=False)
    monkeypatch.setattr(trustlist, "load_roots", lambda allow_fetch=True: [ca3])
    r = _upload(c, doc3, signed3)
    assert r.json()["check"]["level"] == "valid" and r.json()["check"]["qc_marked"] is False


def test_tampered_or_foreign_document_rejected(admin_client, monkeypatch, outboxes):  # noqa: F811
    c = admin_client
    _, doc = _doc(c)
    original = c.get(f"/api/documents/{doc['id']}/download?format=pdf").content
    signed, ca_der = _sign_pdf(original)
    monkeypatch.setattr(trustlist, "load_roots", lambda allow_fetch=True: [ca_der])
    # zmiana bajtu w podpisanym zakresie → podpis nieprawidłowy
    bad = signed[:7] + (b"9" if signed[7:8] != b"9" else b"8") + signed[8:]
    r = _upload(c, doc, bad)
    assert r.status_code == 400 and "nieprawidłowy" in r.json()["detail"]
    # poprawnie podpisany, ale inny dokument
    from tests.test_documents import simple_docx, upload

    other = upload(
        c, simple_docx("Zupełnie inny dokument o czymś innym niż deklaracja kandydata"), "Inny"
    ).json()
    emp_id = c.get("/api/employees").json()["items"][0]["id"]
    d2 = c.post(f"/api/employees/{emp_id}/documents", json={"template_id": other["id"], "values": {}}).json()
    foreign = c.get(f"/api/documents/{d2['id']}/download?format=pdf").content
    signed_foreign, _ = _sign_pdf(foreign)
    r = _upload(c, doc, signed_foreign)
    assert r.status_code == 400 and "inną treść" in r.json()["detail"]


def test_strict_mode_requires_original_as_prefix(admin_client, monkeypatch, outboxes):  # noqa: F811
    c = admin_client
    emp, doc = _doc(c)
    c.patch(f"/api/templates/{doc['template_id']}", json={"strict_pdf": True})
    assert c.get(f"/api/templates/{doc['template_id']}").json()["strict_pdf"] is True
    original = c.get(f"/api/documents/{doc['id']}/download?format=pdf").content
    # podpis dopisany na końcu (aktualizacja przyrostowa) → przechodzi
    signed, ca_der = _sign_pdf(original)
    monkeypatch.setattr(trustlist, "load_roots", lambda allow_fetch=True: [ca_der])
    assert signed.startswith(original)
    assert _upload(c, doc, signed).status_code == 200
    # ten sam plik przepisany przez inny program (te same słowa, inne bajty) → odrzucony w trybie ścisłym
    doc2 = _again(c, emp, doc)
    original2 = c.get(f"/api/documents/{doc2['id']}/download?format=pdf").content
    rewritten = PdfWriter(clone_from=PdfReader(io.BytesIO(original2)))
    rewritten.add_metadata({"/Producer": "inny program"})
    buf = io.BytesIO()
    rewritten.write(buf)
    assert not buf.getvalue().startswith(original2)
    signed2, ca2 = _sign_pdf(buf.getvalue())
    monkeypatch.setattr(trustlist, "load_roots", lambda allow_fetch=True: [ca2])
    r = _upload(c, doc2, signed2)
    assert r.status_code == 400 and "bez żadnych zmian" in r.json()["detail"]
    # po wyłączeniu trybu ścisłego ten sam plik jest akceptowany (porównanie słów)
    c.patch(f"/api/templates/{doc['template_id']}", json={"strict_pdf": False})
    assert _upload(c, doc2, signed2).status_code == 200


def _forge_rsa(digest: bytes, null_params: bool):
    """Podpis RSA PKCS#1 v1.5 z DigestInfo z NULL albo bez NULL (jak robi gov.pl)."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nums = key.private_numbers()
    oid = bytes.fromhex("0609608648016503040201")
    di = (
        bytes.fromhex("3031300d") + oid + bytes.fromhex("05000420") + digest
        if null_params
        else bytes.fromhex("302f300b") + oid + bytes.fromhex("0420") + digest
    )
    k = 256
    em = b"\x00\x01" + b"\xff" * (k - len(di) - 3) + b"\x00" + di
    sig = pow(int.from_bytes(em, "big"), nums.d, nums.public_numbers.n).to_bytes(k, "big")
    return nums.public_numbers.n, nums.public_numbers.e, sig


def test_lenient_rsa_accepts_digestinfo_without_null_but_not_wrong_hash():
    digest = hashlib.sha256(b"dokument").digest()
    for null_params in (True, False):
        n, e, sig = _forge_rsa(digest, null_params)
        assert qualified.lenient_pkcs1_ok(n, e, sig, digest, "sha256") is True
        # inny skrót, zmieniony podpis albo nieznany algorytm → odrzucone
        assert qualified.lenient_pkcs1_ok(n, e, sig, hashlib.sha256(b"inny").digest(), "sha256") is False
        assert qualified.lenient_pkcs1_ok(n, e, sig[:-1] + bytes([sig[-1] ^ 1]), digest, "sha256") is False
        assert qualified.lenient_pkcs1_ok(n, e, sig, digest, "md5") is False


def test_chain_trusted_with_intermediate_ca_as_anchor():
    """Na unijnej liście bywa urząd pośredni (nie samopodpisany) – ma być zaufany, obcy urząd nie."""
    now = datetime.now(UTC)
    keys = [ec.generate_private_key(ec.SECP256R1()) for _ in range(4)]

    def make(subject, issuer, pub, signer, ca):
        b = (
            x509.CertificateBuilder()
            .subject_name(_name(subject))
            .issuer_name(_name(issuer))
            .public_key(pub)
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=300))
            .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        )
        return b.sign(signer, hashes.SHA256())

    der = lambda c: c.public_bytes(serialization.Encoding.DER)  # noqa: E731
    inter = make("Urząd pośredni", "Korzeń", keys[1].public_key(), keys[0], True)
    other = make("Obcy urząd", "Obcy urząd", keys[3].public_key(), keys[3], True)
    leaf = make("Podpisujący", "Urząd pośredni", keys[2].public_key(), keys[1], False)
    a_leaf = ax509.Certificate.load(der(leaf))
    assert qualified._chain_trusted(a_leaf, [der(other), der(inter)], now) is True
    assert qualified._chain_trusted(a_leaf, [der(other)], now) is False


# ---------- potwierdzenie blokadą urządzenia (WebAuthn) ----------


def _own_origin() -> str:
    p = urlparse(get_settings().public_url)
    return f"{p.scheme}://{p.netloc}"


def _credential(options: dict, uv: bool = True, origin: str | None = None) -> dict:
    origin = origin or _own_origin()
    priv = ec.generate_private_key(ec.SECP256R1())
    nums = priv.public_key().public_numbers()
    cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")})
    cred_id = os.urandom(16)
    flags = 0x01 | (0x04 if uv else 0) | 0x40
    auth = (
        hashlib.sha256(options["rp"]["id"].encode()).digest()
        + bytes([flags])
        + (0).to_bytes(4, "big")
        + b"\0" * 16
        + len(cred_id).to_bytes(2, "big")
        + cred_id
        + cose
    )
    att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})
    cdj = json.dumps(
        {"type": "webauthn.create", "challenge": options["challenge"], "origin": origin, "crossOrigin": False}
    ).encode()
    return {
        "id": _b64(cred_id),
        "rawId": _b64(cred_id),
        "type": "public-key",
        "response": {"clientDataJSON": _b64(cdj), "attestationObject": _b64(att), "transports": ["internal"]},
        "clientExtensionResults": {},
    }


def _device_link(c, doc):
    r = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika", "device_check": True})
    token = r.json()["link"].rsplit("/", 1)[1]
    pub = TestClient(app)
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    return pub, token, view


def test_device_check_required_and_recorded(admin_client, outboxes):  # noqa: F811
    c = admin_client
    _, doc = _doc(c)
    pub, token, view = _device_link(c, doc)
    assert pub.get(f"/api/sign/{token}").json()["device_check"] is True
    body = {"image": _sig_png(), "view": view, "consent": True}

    # bez potwierdzenia urządzeniem – odmowa
    assert pub.post(f"/api/sign/{token}", json=body).status_code == 400

    opts = pub.post(f"/api/sign/{token}/device/options", json={"view": view})
    assert opts.status_code == 200, opts.text
    o = opts.json()
    sel = o["authenticatorSelection"]
    assert sel["userVerification"] == "required" and sel["authenticatorAttachment"] == "platform"

    # brak flagi weryfikacji użytkownika (np. tylko dotknięcie klucza) – odmowa; wyzwanie jednorazowe
    r = pub.post(f"/api/sign/{token}", json={**body, "device": _credential(o, uv=False)})
    assert r.status_code == 400 and "blokadą urządzenia" in r.json()["detail"]
    assert (
        pub.post(f"/api/sign/{token}", json={**body, "device": _credential(o)}).status_code == 400
    )  # stare wyzwanie

    o = pub.post(f"/api/sign/{token}/device/options", json={"view": view}).json()
    # inna strona (domena) – odmowa
    assert (
        pub.post(
            f"/api/sign/{token}", json={**body, "device": _credential(o, origin="https://zly.pl")}
        ).status_code
        == 400
    )
    o = pub.post(f"/api/sign/{token}/device/options", json={"view": view}).json()
    r = pub.post(f"/api/sign/{token}", json={**body, "device": _credential(o)})
    assert r.status_code == 200, r.text

    st = c.get(f"/api/documents/{doc['id']}/signatures").json()["roles"][0]
    assert st["status"] == "signed" and st["device_verified"] is True
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import AuditLog

    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.action == "document_signed")).all()[-1]
        assert log.details["device_verified"] is True
    # strona potwierdzenia w PDF wspomina o potwierdzeniu na urządzeniu
    text = "\n".join(
        p.extract_text()
        for p in PdfReader(io.BytesIO(c.get(f"/api/documents/{doc['id']}/signed").content)).pages
    )
    assert "Potwierdzenie na urządzeniu: tak" in text


def test_device_check_optional_by_default(admin_client, outboxes):  # noqa: F811
    c = admin_client
    _, doc = _doc(c)
    link = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika"}).json()["link"]
    token = link.rsplit("/", 1)[1]
    pub = TestClient(app)
    info = pub.get(f"/api/sign/{token}").json()
    assert info["device_check"] is False
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    assert pub.post(f"/api/sign/{token}/device/options", json={"view": view}).status_code == 400
    r = pub.post(f"/api/sign/{token}", json={"image": _sig_png(), "view": view, "consent": True})
    assert r.status_code == 200


def test_trustlist_parsing():
    cert = base64.b64encode(b"DER-1").decode()
    lotl = (
        b'<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#"><SchemeInformation><PointersToOtherTSL>'
        b"<OtherTSLPointer><ServiceDigitalIdentities/><TSLLocation>https://tsl.example.pl/pl.xml</TSLLocation>"
        b"<AdditionalInformation><OtherInformation><SchemeTerritory>PL</SchemeTerritory></OtherInformation>"
        b"</AdditionalInformation></OtherTSLPointer>"
        b"<OtherTSLPointer><TSLLocation>https://tsl.example.de/de.xml</TSLLocation><AdditionalInformation>"
        b"<OtherInformation><SchemeTerritory>DE</SchemeTerritory></OtherInformation></AdditionalInformation>"
        b"</OtherTSLPointer></PointersToOtherTSL></SchemeInformation></TrustServiceStatusList>"
    )
    assert trustlist.tsl_locations(lotl, ["PL"]) == ["https://tsl.example.pl/pl.xml"]
    tsl = (
        '<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#"><TrustServiceProviderList>'
        "<TrustServiceProvider><TSPServices>"
        "<TSPService><ServiceInformation><ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/CA/QC"
        "</ServiceTypeIdentifier><ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted"
        f"</ServiceStatus><ServiceDigitalIdentity><DigitalId><X509Certificate>{cert}</X509Certificate>"
        "</DigitalId></ServiceDigitalIdentity></ServiceInformation></TSPService>"
        "<TSPService><ServiceInformation><ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/CA/QC"
        "</ServiceTypeIdentifier><ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/withdrawn"
        f"</ServiceStatus><ServiceDigitalIdentity><DigitalId><X509Certificate>{base64.b64encode(b'DER-2').decode()}"
        "</X509Certificate></DigitalId></ServiceDigitalIdentity></ServiceInformation></TSPService>"
        "</TSPServices></TrustServiceProvider></TrustServiceProviderList></TrustServiceStatusList>"
    ).encode()
    assert trustlist.qualified_cas(tsl) == [b"DER-1"]  # wycofane usługi pomijamy


def test_xml_signature_is_not_verified():
    res = qualified.verify(
        b'<?xml version="1.0"?><Signature><SignatureValue>x</SignatureValue></Signature>', None
    )
    assert res.level == "unverified"
