"""Weryfikacja plików podpisanych podpisem zaufanym lub kwalifikowanym (PAdES w PDF).

Sprawdzamy: czy podpis jest nienaruszony i matematycznie poprawny, czy dokument nie został zmieniony po
podpisaniu, czy certyfikat ma oznaczenie „kwalifikowany” (QcCompliance) i czy łańcuch kończy się na urzędzie
z unijnej listy zaufania (kwalifikowany dostawca usług zaufania). Nie sprawdzamy unieważnienia certyfikatu
(CRL / OCSP). Podpisów XML (XAdES) nie weryfikujemy – wynik „niezweryfikowany”.
"""

import hashlib
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


_DIGEST_INFO = {  # prefiksy DigestInfo (PKCS#1) dla popularnych skrótów
    "sha256": bytes.fromhex("3031300d060960864801650304020105000420"),
    "sha384": bytes.fromhex("3041300d060960864801650304020205000430"),
    "sha512": bytes.fromhex("3051300d060960864801650304020305000440"),
}


def lenient_pkcs1_ok(n: int, e: int, signature: bytes, digest: bytes, hash_name: str) -> bool:
    """Podpis RSA PKCS#1 v1.5, także gdy DigestInfo nie ma parametrów NULL (tak podpisuje m.in. gov.pl).

    Ścisłe biblioteki to odrzucają, choć podpis jest poprawny (RFC 8017 zaleca akceptować obie postacie).
    Porównujemy cały blok 00 01 FF… 00 || DigestInfo || skrót, więc nie obniża to bezpieczeństwa.
    """
    prefix = _DIGEST_INFO.get(hash_name)
    if prefix is None:
        return False
    k = (n.bit_length() + 7) // 8
    if len(signature) != k or int.from_bytes(signature, "big") >= n:
        return False
    em = pow(int.from_bytes(signature, "big"), e, n).to_bytes(k, "big")
    with_null = prefix + digest
    # postać bez NULL: usuwamy „05 00” i zmniejszamy długości (SEQUENCE zewnętrzna i AlgorithmIdentifier)
    without = (
        bytes([prefix[0], prefix[1] - 2, prefix[2], prefix[3] - 2]) + prefix[4:-4] + prefix[-2:] + digest
    )
    for di in (with_null, without):
        pad = k - len(di) - 3
        if pad >= 8 and em == b"\x00\x01" + b"\xff" * pad + b"\x00" + di:
            return True
    return False


def _lenient_signature_ok(emb) -> bool:  # noqa: ANN001
    """Fallback, gdy pyHanko uznał skrót za zgodny, ale odrzucił podpis RSA z powodu kodowania DigestInfo."""
    from asn1crypto import cms

    try:
        sd = emb.pkcs7_content
        sd = cms.ContentInfo.load(sd.dump() if hasattr(sd, "dump") else bytes(sd))["content"]
        si = sd["signer_infos"][0]
        if (
            not str(si["signature_algorithm"]["algorithm"].native).endswith("_rsa")
            or si["signed_attrs"].native is None
        ):
            return False
        sid = si["sid"].chosen
        cert = next(
            c.chosen
            for c in sd["certificates"]
            if c.name == "certificate"
            and c.chosen.serial_number == sid["serial_number"].native
            and c.chosen.issuer == sid["issuer"]
        )
        hash_name = si["digest_algorithm"]["algorithm"].native
        digest = hashlib.new(hash_name, b"\x31" + si["signed_attrs"].dump()[1:]).digest()
        pub = cert.public_key.native["public_key"]
        return lenient_pkcs1_ok(
            pub["modulus"], pub["public_exponent"], si["signature"].native, digest, hash_name
        )
    except Exception:  # noqa: BLE001
        return False


def _chain_trusted(cert, roots: list[bytes], at) -> bool:  # noqa: ANN001
    """Czy certyfikat podpisującego łączy się łańcuchem z urzędem z listy zaufania (na moment podpisu)."""
    import asyncio

    from asn1crypto import x509 as ax509
    from pyhanko_certvalidator import CertificateValidator, ValidationContext

    try:
        vc = ValidationContext(
            trust_roots=[ax509.Certificate.load(c) for c in roots],
            allow_fetching=False,
            revocation_mode="soft-fail",
            moment=at,
        )
        asyncio.run(CertificateValidator(cert, validation_context=vc).async_validate_usage(set()))
        return True
    except Exception:  # noqa: BLE001
        return False


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
    sig_ok = st.valid or (st.intact and _lenient_signature_ok(emb))
    if not st.intact or not sig_ok:
        res.level = "invalid"
        res.notes.append("Podpis jest uszkodzony albo dokument zmieniono po podpisaniu.")
        cov = getattr(st.coverage, "name", st.coverage)
        res.notes.append(
            f"Szczegóły techniczne: skrót zgodny={st.intact}, podpis poprawny={st.valid}, zakres={cov}."
        )
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
    if roots and not st.valid:
        # podpis uznany przez nasze sprawdzenie (nie przez pyHanko) – zaufanie do łańcucha liczymy osobno
        res.trusted = _chain_trusted(cert, roots, st.signer_reported_dt)
    else:
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
