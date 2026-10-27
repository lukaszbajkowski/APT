"""Weryfikacja plików podpisanych podpisem zaufanym lub kwalifikowanym (PAdES w PDF).

Sprawdzamy: czy podpis jest nienaruszony i matematycznie poprawny, czy dokument nie został zmieniony po
podpisaniu, czy certyfikat ma oznaczenie „kwalifikowany” (QcCompliance) i czy łańcuch kończy się na urzędzie
z unijnej listy zaufania (kwalifikowany dostawca usług zaufania). Nie sprawdzamy unieważnienia certyfikatu
(CRL / OCSP). Podpisów XML (XAdES) nie weryfikujemy – wynik „niezweryfikowany”.
"""

import io
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from cryptography import x509 as cx509

QC_STATEMENTS_OID = "1.3.6.1.5.5.7.1.3"
# OID-y wewnątrz rozszerzenia QCStatements (DER): id-etsi-qcs-QcCompliance i QcSSCD
QC_COMPLIANCE = b"\x06\x06\x04\x00\x8e\x46\x01\x01"
QC_SSCD = b"\x06\x06\x04\x00\x8e\x46\x01\x04"

LEVEL_LABEL = {
    "qualified": "podpis kwalifikowany – ważny",
    "valid": "podpis elektroniczny – ważny (nie kwalifikowany)",
    "unverified": "podpis niezweryfikowany",
    "invalid": "podpis nieprawidłowy",
}


@dataclass
class Result:
    level: str  # qualified | valid | unverified | invalid
    signer: str | None = None
    issuer: str | None = None
    signed_at: str | None = None
    qc_marked: bool = False  # certyfikat ma oznaczenie „kwalifikowany”
    sscd: bool = False  # klucz na urządzeniu kwalifikowanym (QSCD)
    trusted: bool | None = None  # łańcuch do urzędu z listy zaufania; None – nie sprawdzono
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["label"] = LEVEL_LABEL[self.level]
        return d


def qc_flags(cert_der: bytes) -> tuple[bool, bool]:
    """(QcCompliance, QcSSCD) z rozszerzenia QCStatements certyfikatu."""
    try:
        cert = cx509.load_der_x509_certificate(cert_der)
        for ext in cert.extensions:
            if ext.oid.dotted_string == QC_STATEMENTS_OID:
                raw = getattr(ext.value, "value", b"")
                return QC_COMPLIANCE in raw, QC_SSCD in raw
    except ValueError:
        pass
    return False, False


def _name(n: Any) -> str | None:
    native = n.native if n is not None else {}
    return native.get("common_name") or native.get("organization_name") or native.get("serial_number")


def _words(pdf: bytes) -> list[str]:
    import pdfplumber

    out: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        for page in doc.pages:
            out += re.findall(r"\w+", (page.extract_text() or "").lower())
    return out


def same_content(reference_pdf: bytes, signed_pdf: bytes, tolerance: float = 0.1) -> bool | None:
    """Czy podpisany plik zawiera treść dokumentu (słowa z oryginału). None – nie dało się porównać."""
    try:
        ref, got = set(_words(reference_pdf)), set(_words(signed_pdf))
    except Exception:  # noqa: BLE001
        return None
    if len(ref) < 5:
        return None
    return len(ref - got) <= tolerance * len(ref)


def starts_with_original(signed_pdf: bytes, *originals: bytes) -> bool:
    """Tryb ścisły: podpisany plik zaczyna się od któregoś z oryginałów (bajt w bajt)."""
    return any(o and signed_pdf.startswith(o) for o in originals)


def verify_pdf(data: bytes, roots: list[bytes] | None) -> Result:
    """Weryfikuje pierwszy podpis w PDF. roots – urzędy z listy zaufania (DER) albo None."""
    from asn1crypto import x509 as ax509
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.diff_analysis import ModificationLevel
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    try:
        reader = PdfFileReader(io.BytesIO(data))
        sigs = list(reader.embedded_regular_signatures)
    except Exception:  # noqa: BLE001
        return Result("unverified", notes=["Nie udało się odczytać podpisów w pliku PDF."])
    if not sigs:
        return Result("unverified", notes=["W pliku PDF nie znaleziono podpisu elektronicznego."])
    emb = sigs[-1]  # ostatni = obejmuje całość
    try:
        trust = [ax509.Certificate.load(c) for c in roots] if roots else None
        vc = ValidationContext(trust_roots=trust, allow_fetching=False, revocation_mode="soft-fail")
        st = validate_pdf_signature(emb, vc)
    except Exception:  # noqa: BLE001
        return Result("unverified", notes=["Nie udało się sprawdzić podpisu w pliku."])

    cert = st.signing_cert
    res = Result("valid")
    if cert is not None:
        res.signer = _name(cert.subject)
        res.issuer = _name(cert.issuer)
        res.qc_marked, res.sscd = qc_flags(cert.dump())
    if st.signer_reported_dt:
        res.signed_at = st.signer_reported_dt.isoformat()
    if not st.intact or not st.valid:
        res.level = "invalid"
        res.notes.append("Podpis jest uszkodzony albo dokument zmieniono po podpisaniu.")
        return res
    mod = st.modification_level
    if mod is not None and mod not in (
        ModificationLevel.NONE,
        ModificationLevel.LTA_UPDATES,
        ModificationLevel.FORM_FILLING,
    ):
        res.level = "invalid"
        res.notes.append("Dokument zmieniono po złożeniu podpisu.")
        return res
    res.trusted = bool(st.trusted) if roots else None
    if roots is None:
        res.notes.append("Nie sprawdzono łańcucha certyfikatów (brak unijnej listy zaufania).")
    if res.qc_marked and res.trusted:
        res.level = "qualified"
        if not res.sscd:
            res.notes.append("Certyfikat bez oznaczenia urządzenia kwalifikowanego (QSCD).")
    elif res.qc_marked:
        res.notes.append(
            "Certyfikat ma oznaczenie „kwalifikowany”, ale nie potwierdzono jego wystawcy na liście zaufania."
        )
    res.notes.append("Nie sprawdzano unieważnienia certyfikatu (CRL / OCSP).")
    return res


def verify(data: bytes, roots: list[bytes] | None) -> Result:
    """PDF – pełna weryfikacja; XML (XAdES) – tylko informacja, że nie weryfikujemy."""
    if data[:4] == b"%PDF":
        return verify_pdf(data, roots)
    return Result("unverified", notes=["Podpisów XML (XAdES) nie weryfikujemy automatycznie."])


def lines(check: dict[str, Any]) -> list[str]:
    """Wiersze do strony potwierdzenia w PDF."""
    out = [
        f"Weryfikacja podpisu w pliku: {check.get('label') or LEVEL_LABEL.get(check.get('level', ''), '—')}"
    ]
    if check.get("signer"):
        out.append(f"Podpisujący (certyfikat): {check['signer']}; wystawca: {check.get('issuer') or '—'}")
    out += [str(n) for n in check.get("notes", [])]
    return out
