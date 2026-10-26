import base64
import io
import re
from datetime import date

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader
from sqlalchemy import select

from app import mailer, sms
from app.db import SessionLocal
from app.models import AuditLog
from app.templating import soffice_path
from tests.conftest import make_pesel
from tests.test_documents import simple_docx, upload

pytestmark = pytest.mark.skipif(soffice_path() is None, reason="brak LibreOffice")

BORN = date(1990, 5, 1)
PESEL = make_pesel(BORN, "K")


def _sig_png() -> str:
    img = Image.new("RGBA", (500, 160), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    d.line([(10, 120), (120, 30), (220, 140), (330, 40), (480, 120)], fill=(0, 0, 120, 255), width=6)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def outboxes():
    mailer.outbox, sms.outbox = [], []
    yield mailer.outbox, sms.outbox
    mailer.outbox, sms.outbox = None, None


def _doc(c):
    e = c.post("/api/employees", json={"first_name": "Ola", "last_name": "Nowak", "pesel": PESEL}).json()
    tpl = simple_docx(
        "Deklaracja {{ nazwisko_imie }}",
        "Data i podpis Ubezpieczonego: {{ data_podpisu_pracownika }} {{ podpis_pracownika }}",
        "Za firmę: {{ podpis_firmy }}",
    )
    t = upload(c, tpl, "Deklaracja z podpisem").json()
    assert t["fields"] == []  # znaczniki podpisu to dane wbudowane, nie pola formularza
    d = c.post(f"/api/employees/{e['id']}/documents", json={"template_id": t["id"], "values": {}})
    assert d.status_code == 201, d.text
    doc = d.json()
    assert doc["signature_roles"] == ["pracownika", "firmy"]
    return e, doc


def _token(text: str) -> str:
    return re.search(r"/podpis/([\w-]+)", text).group(1)


def test_sign_on_screen_flow(admin_client, outboxes):
    c = admin_client
    mails, smses = outboxes
    e, doc = _doc(c)
    st = c.get(f"/api/documents/{doc['id']}/signatures").json()
    assert [r["status"] for r in st["roles"]] == ["none", "none"]

    r = c.post(
        f"/api/documents/{doc['id']}/signatures",
        json={"role": "pracownika", "channel": "email", "to": "ola@example.com"},
    )
    assert r.status_code == 201 and r.json()["sent"]
    token = _token(mails[-1][2])
    assert token in r.json()["link"]
    assert (
        c.get(f"/api/documents/{doc['id']}/signatures").json()["roles"][0]["sent_to"] == "ol***@example.com"
    )
    assert c.get(f"/api/employees/{e['id']}/documents").json()[0]["signature_pending"] is True

    # publiczna strona – bez logowania
    from fastapi.testclient import TestClient

    from app.main import app

    pub = TestClient(app)
    info = pub.get(f"/api/sign/{token}").json()
    assert (
        info["needs_birth_date"]
        and info["person"] == "Ola N."
        and info["document"] == "Deklaracja z podpisem"
    )
    assert pub.get(f"/api/sign/{token}/page/0").status_code == 403  # bez potwierdzenia daty urodzenia
    bad = pub.post(f"/api/sign/{token}/verify", json={"birth_date": "1991-01-01"})
    assert bad.status_code == 403 and "Pozostało prób: 4" in bad.json()["detail"]
    ok = pub.post(f"/api/sign/{token}/verify", json={"birth_date": BORN.isoformat()}).json()
    assert ok["pages"] == 1
    page = pub.get(f"/api/sign/{token}/page/0", params={"v": ok["view"]})
    assert page.status_code == 200 and page.content[:4] == b"\x89PNG"
    assert (
        pub.post(
            f"/api/sign/{token}", json={"image": _sig_png(), "view": ok["view"], "consent": False}
        ).status_code
        == 400
    )
    empty = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
    eb = io.BytesIO()
    empty.save(eb, "PNG")
    blank = "data:image/png;base64," + base64.b64encode(eb.getvalue()).decode()
    assert (
        "puste"
        in pub.post(f"/api/sign/{token}", json={"image": blank, "view": ok["view"], "consent": True}).json()[
            "detail"
        ]
    )
    r = pub.post(f"/api/sign/{token}", json={"image": _sig_png(), "view": ok["view"], "consent": True})
    assert r.status_code == 200, r.text
    assert pub.get(f"/api/sign/{token}").status_code == 404  # link jednorazowy

    st = c.get(f"/api/documents/{doc['id']}/signatures").json()
    assert st["roles"][0]["status"] == "signed" and st["roles"][0]["signer_name"] == "Ola Nowak"
    # checklista: „podpisany przez pracownika” odhacza się automatycznie
    from app import lifecycle
    from app.models import ChecklistItem, Employee

    opts = [o["value"] for o in c.get("/api/checklist-templates").json()["auto_options"]]
    assert f"signed:{doc['template_id']}" in opts
    with SessionLocal() as db:
        emp = db.get(Employee, e["id"])
        it = ChecklistItem(
            employee_id=emp.id, kind="onboarding", label="Deklaracja", auto=f"signed:{doc['template_id']}"
        )
        assert lifecycle.auto_done(db, it, emp)
        it.auto = "signed:999999"
        assert not lifecycle.auto_done(db, it, emp)
    assert st["has_signed_pdf"] and st["signed_at"] is None  # brakuje podpisu firmy
    signed = c.get(f"/api/documents/{doc['id']}/signed")
    pdf = PdfReader(io.BytesIO(signed.content))
    assert len(pdf.pages) == 2 and "Potwierdzenie podpisów" in pdf.pages[1].extract_text()

    # podpis firmy przez SMS – osoba wpisuje imię i nazwisko
    r = c.post(
        f"/api/documents/{doc['id']}/signatures",
        json={"role": "firmy", "channel": "sms", "to": "600 100 200"},
    )
    assert r.status_code == 201 and smses[-1][0] == "48600100200"
    t2 = _token(smses[-1][1])
    assert pub.get(f"/api/sign/{t2}").json()["needs_name"] is True
    assert pub.post(f"/api/sign/{t2}", json={"image": _sig_png(), "consent": True}).status_code == 400
    assert (
        pub.post(
            f"/api/sign/{t2}", json={"image": _sig_png(), "consent": True, "signer_name": "Jan Kierownik"}
        ).status_code
        == 200
    )
    st = c.get(f"/api/documents/{doc['id']}/signatures").json()
    assert st["signed_at"] is not None
    text = PdfReader(io.BytesIO(c.get(f"/api/documents/{doc['id']}/signed").content)).pages[-1].extract_text()
    assert "Ola Nowak" in text and "Jan Kierownik" in text
    # podgląd pokazuje wersję podpisaną
    view = c.get(f"/api/documents/{doc['id']}/view")
    assert "podpisany" in view.headers["content-disposition"]
    assert "Potwierdzenie podpisów" in PdfReader(io.BytesIO(view.content)).pages[-1].extract_text()
    pv = c.get(f"/api/documents/{doc['id']}/preview").json()
    assert pv["signed"] and pv["pages"] == 2
    png = c.get(f"/api/documents/{doc['id']}/preview/1")
    assert png.headers["content-type"] == "image/png" and png.content[:4] == b"\x89PNG"
    assert c.get(f"/api/documents/{doc['id']}/preview/5").status_code == 404
    dl = c.get(f"/api/documents/{doc['id']}/download?format=pdf")
    assert "podpisany" in dl.headers["content-disposition"]
    assert "Potwierdzenie podpisów" in PdfReader(io.BytesIO(dl.content)).pages[-1].extract_text()
    # usunięcie podpisu firmy: dokument znów czeka na podpis, podpis pracownika zostaje
    firm = next(
        r for r in c.get(f"/api/documents/{doc['id']}/signatures").json()["roles"] if r["role"] == "firmy"
    )
    assert c.post(f"/api/signatures/{firm['request_id']}/remove", json={"reason": "x"}).status_code == 422
    st = c.post(f"/api/signatures/{firm['request_id']}/remove", json={"reason": "zła osoba"}).json()
    assert st["signed_at"] is None and st["has_signed_pdf"]
    assert [r["status"] for r in st["roles"]] == ["signed", "none"]
    text = PdfReader(io.BytesIO(c.get(f"/api/documents/{doc['id']}/signed").content)).pages[-1].extract_text()
    assert "Ola Nowak" in text and "Jan Kierownik" not in text
    emp = st["roles"][0]["request_id"]
    st = c.post(f"/api/signatures/{emp}/remove", json={"reason": "zła osoba"}).json()
    assert not st["has_signed_pdf"] and c.get(f"/api/documents/{doc['id']}/signed").status_code == 404
    with SessionLocal() as db:
        actions = [a.action for a in db.scalars(select(AuditLog).order_by(AuditLog.id))]
        assert actions.count("signature_removed") == 2
        assert actions.count("document_signed") == 2 and "signature_requested" in actions


def test_trusted_scan_lockout_and_cancel(admin_client, outboxes):
    c = admin_client
    emp, doc = _doc(c)
    from fastapi.testclient import TestClient

    from app.main import app

    pub = TestClient(app)
    link = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika"}).json()["link"]
    token = link.rsplit("/", 1)[1]
    # 5 błędnych prób blokuje link
    for _ in range(4):
        pub.post(f"/api/sign/{token}/verify", json={"birth_date": "2000-01-01"})
    last = pub.post(f"/api/sign/{token}/verify", json={"birth_date": "2000-01-01"})
    assert last.status_code == 410

    link = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika"}).json()["link"]
    token = link.rsplit("/", 1)[1]
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": BORN.isoformat()}).json()["view"]
    plain = pub.post(
        f"/api/sign/{token}/trusted", files={"file": ("x.pdf", b"%PDF-1.4 nic")}, data={"view": view}
    )
    assert plain.status_code == 400
    original = c.get(f"/api/documents/{doc['id']}/download?format=pdf").content
    fake = original + b"\n% /Type /Sig /ByteRange [0 1 2 3] /SubFilter /ETSI.CAdES.detached\n"
    r = pub.post(f"/api/sign/{token}/trusted", files={"file": ("podpisany.pdf", fake)}, data={"view": view})
    assert r.status_code == 200, r.text
    st = c.get(f"/api/documents/{doc['id']}/signatures").json()
    assert st["roles"][0]["method"] == "zaufany"
    sid = st["roles"][0]["request_id"]
    assert c.get(f"/api/signatures/{sid}/file").content == fake
    # podpisana wersja = plik z podpisem zaufanym bez zmian (podgląd, PDF, „Pobierz podpisany”)
    assert c.get(f"/api/documents/{doc['id']}/signed").content == fake
    assert c.get(f"/api/documents/{doc['id']}/view").content == fake
    assert c.get(f"/api/documents/{doc['id']}/download?format=pdf").content == fake
    # podgląd: strony dokumentu + strona potwierdzenia (podpis w pliku jest niewidoczny)
    pages = len(PdfReader(io.BytesIO(original)).pages)
    assert c.get(f"/api/documents/{doc['id']}/preview").json()["pages"] == pages + 1
    assert c.get(f"/api/documents/{doc['id']}/preview/{pages}").content[:4] == b"\x89PNG"
    # skan niedozwolony, gdy jest podpis elektroniczny
    assert c.get(f"/api/documents/{doc['id']}/signatures").json()["scan_allowed"] is False
    r = c.post(f"/api/documents/{doc['id']}/signatures/scan", files={"file": ("skan.pdf", b"%PDF-1.4 skan")})
    assert r.status_code == 409

    # anulowanie prośby firmy
    req = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "firmy"}).json()
    assert c.delete(f"/api/signatures/{req['id']}").status_code == 204
    assert pub.get(f"/api/sign/{req['link'].rsplit('/', 1)[1]}").status_code == 404

    # skan papierowego dokumentu = podpisany (inny dokument, bez podpisu elektronicznego)
    doc2 = c.post(
        f"/api/employees/{emp['id']}/documents",
        json={"template_id": doc["template_id"], "values": {}},
    ).json()
    r = c.post(f"/api/documents/{doc2['id']}/signatures/scan", files={"file": ("skan.pdf", b"%PDF-1.4 skan")})
    assert r.json()["scan"] and r.json()["signed_at"]


def test_delete_document(admin_client, make_user, outboxes):
    from pathlib import Path

    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import app
    from app.models import Role

    c = admin_client
    e, doc = _doc(c)
    r = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika", "channel": "link"})
    token = r.json()["link"].rsplit("/", 1)[1]
    pub = TestClient(app)
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    pub.post(f"/api/sign/{token}", json={"image": _sig_png(), "view": view, "consent": True})
    folder = Path(get_settings().data_dir) / "documents" / str(e["id"])
    assert len(list(folder.glob(f"{doc['id']}*"))) >= 3  # docx, pdf, podpisany, obraz podpisu

    # kierownik: tylko własny, niepodpisany
    from app.models import GeneratedDocument, User
    from app.routers.documents import can_delete

    mgr = make_user("kier", Role.manager)
    with SessionLocal() as db:
        d = db.get(GeneratedDocument, doc["id"])
        u = db.get(User, mgr.id)
        assert not can_delete(d, u)  # cudzy i podpisany
        d.created_by = u.id
        assert not can_delete(d, u)  # własny, ale podpisany
        d.has_signed_pdf, d.signed_at = False, None
        assert can_delete(d, u)
    listed = c.get(f"/api/employees/{e['id']}/documents").json()
    assert listed[0]["can_delete"] is True
    assert c.post(f"/api/documents/{doc['id']}/delete", json={"reason": ""}).status_code == 422
    r = c.post(f"/api/documents/{doc['id']}/delete", json={"reason": "zła osoba"})
    assert r.status_code == 204, r.text
    assert c.get(f"/api/employees/{e['id']}/documents").json() == []
    assert list(folder.glob(f"{doc['id']}*")) == []
    with SessionLocal() as db:
        log = db.scalars(select(AuditLog).where(AuditLog.action == "document_deleted")).one()
        assert log.details["reason"] == "zła osoba" and log.details["signed"] is True
        assert log.details["signatures"] == 1


def test_trusted_xades_xml(admin_client, outboxes):
    """gov.pl zwraca często plik XML (XAdES) z dokumentem PDF zaszytym w środku."""
    from fastapi.testclient import TestClient

    from app.main import app

    c = admin_client
    _, doc = _doc(c)
    original = c.get(f"/api/documents/{doc['id']}/download?format=pdf").content
    pages = len(PdfReader(io.BytesIO(original)).pages)
    token = c.post(f"/api/documents/{doc['id']}/signatures", json={"role": "pracownika"}).json()["link"]
    token = token.rsplit("/", 1)[1]
    pub = TestClient(app)
    view = pub.post(f"/api/sign/{token}/verify", json={"birth_date": str(BORN)}).json()["view"]
    b64 = base64.encodebytes(original).decode()
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">'
        f"<ds:SignatureValue>abc</ds:SignatureValue><ds:Object>{b64}</ds:Object></ds:Signature>"
    ).encode()
    r = pub.post(
        f"/api/sign/{token}/trusted", files={"file": ("deklaracja.pdf.xml", xml)}, data={"view": view}
    )
    assert r.status_code == 200, r.text
    # pobieranie = oryginalny plik XML z podpisem
    signed = c.get(f"/api/documents/{doc['id']}/signed")
    assert signed.content == xml and signed.headers["content-disposition"].endswith(".xml")
    assert c.get(f"/api/documents/{doc['id']}/download?format=pdf").content == xml
    # podgląd = dokument z wnętrza XML + strona potwierdzenia
    assert c.get(f"/api/documents/{doc['id']}/preview").json() == {
        "pages": pages + 1,
        "signed": True,
        "title": "Deklaracja z podpisem – Nowak Ola",
    }
    assert c.get(f"/api/documents/{doc['id']}/view").content == original


def test_preview_draws_form_fields():
    """Widoczny podpis z gov.pl to pole formularza – podgląd musi je rysować."""
    from reportlab.pdfgen import canvas

    from app import preview

    buf = io.BytesIO()
    cv = canvas.Canvas(buf)
    cv.drawString(50, 800, "Dokument")
    cv.acroForm.textfield(name="podpis", value="PODPIS", x=50, y=600, width=300, height=40, fontSize=20)
    cv.save()
    img = Image.open(io.BytesIO(preview.render_page(buf.getvalue(), "pdf", 0, "Test")))
    s = preview.SCALE
    box = img.convert("L").crop((int(60 * s), int((842 - 635) * s), int(340 * s), int((842 - 605) * s)))
    assert min(box.getextrema()) < 80  # tekst pola jest narysowany
