"""Zaufany znacznik czasu (RFC 3161) dla podpisanych dokumentów.

Do zewnętrznej usługi (domyślnie FreeTSA.org) wysyłamy wyłącznie skrót SHA-256 podpisanego pliku – nigdy treść
ani dane osobowe. Odpowiedź (token) sprawdzamy: status, zgodność skrótu i nonce, poprawność podpisu usługi,
czas zbliżony do naszego zegara. Token trafia do dziennika zdarzeń (tylko do dopisywania) jako
`document_timestamped`. Brak odpowiedzi usługi nigdy nie blokuje podpisu – znacznik dodaje się w tle,
a zaległe uzupełnia zadanie dzienne.

Uwaga: darmowy znacznik NIE jest kwalifikowanym znacznikiem czasu w rozumieniu eIDAS (brak domniemania
prawnego). Jest za to niezależnym dowodem, że plik o tym skrócie istniał o podanej godzinie.
"""

import asyncio
import base64
import os
import threading
import time
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import AuditLog

MAX_SKEW = timedelta(minutes=10)  # dopuszczalna różnica między czasem znacznika a naszym zegarem
CA_URL = "https://freetsa.org/files/cacert.pem"
_ca_last_try = 0.0


class TimestampError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(get_settings().tsa_url.strip())


def _ca_file() -> Path:
    return Path(get_settings().data_dir) / "tsa-ca.pem"


def _pem_blocks(text: str) -> list[bytes]:
    import re

    out = []
    for m in re.finditer(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", text, re.S):
        out.append(base64.b64decode("".join(m.group(1).split())))
    return out


def fetch_ca() -> int:
    """Pobiera certyfikat urzędu usługi czasu (FreeTSA) do pliku (HTTPS). Zwraca liczbę certyfikatów."""
    with urllib.request.urlopen(CA_URL, timeout=15) as r:  # noqa: S310 – stały adres https
        text = r.read(200_000).decode("ascii", "ignore")
    certs = _pem_blocks(text)
    if not certs:
        raise TimestampError("Pobrany plik nie zawiera certyfikatu.")
    p = _ca_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return len(certs)


def trust_roots(allow_fetch: bool = True) -> list[bytes] | None:
    """Urzędy zaufane usługi czasu (DER) albo None (wtedy sprawdzamy tylko podpis tokenu)."""
    global _ca_last_try
    p = _ca_file()
    if (
        not p.exists()
        and allow_fetch
        and "freetsa.org" in get_settings().tsa_url
        and time.time() - _ca_last_try > 3600
    ):
        _ca_last_try = time.time()
        try:
            fetch_ca()
        except Exception:  # noqa: BLE001
            pass
    try:
        return _pem_blocks(p.read_text()) or None
    except OSError:
        return None


def build_request(digest: bytes) -> tuple[bytes, int]:
    from asn1crypto import tsp

    nonce = int.from_bytes(os.urandom(8), "big")
    req = tsp.TimeStampReq(
        {
            "version": "v1",
            "message_imprint": tsp.MessageImprint(
                {"hash_algorithm": {"algorithm": "sha256"}, "hashed_message": digest}
            ),
            "nonce": nonce,
            "cert_req": True,
        }
    )
    return req.dump(), nonce


def _post(url: str, body: bytes, timeout: float) -> bytes:
    req = urllib.request.Request(  # noqa: S310 – adres z konfiguracji (https)
        url,
        data=body,
        headers={"Content-Type": "application/timestamp-query", "Accept": "application/timestamp-reply"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return r.read(1_000_000)


def check_response(
    resp: bytes, digest: bytes, nonce: int, roots: list[bytes] | None, now: datetime | None = None
) -> dict[str, Any]:
    """Sprawdza odpowiedź usługi czasu; zwraca dane do zapisu (z tokenem w base64) albo TimestampError."""
    from asn1crypto import tsp
    from asn1crypto import x509 as ax509
    from pyhanko.sign.validation.generic_cms import validate_tst_signed_data
    from pyhanko.sign.validation.status import TimestampSignatureStatus
    from pyhanko_certvalidator import ValidationContext

    try:
        r = tsp.TimeStampResp.load(resp)
        status = r["status"]["status"].native
        if status not in ("granted", "granted_with_mods"):
            raise TimestampError(f"Usługa czasu odmówiła: {status}.")
        token = r["time_stamp_token"]
        signed = token["content"]
        info = signed["encap_content_info"]["content"].parsed
    except TimestampError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise TimestampError("Nieprawidłowa odpowiedź usługi czasu.") from exc
    imprint = info["message_imprint"]
    if (
        imprint["hash_algorithm"]["algorithm"].native != "sha256"
        or imprint["hashed_message"].native != digest
    ):
        raise TimestampError("Znacznik dotyczy innego skrótu niż wysłany.")
    if info["nonce"].native != nonce:
        raise TimestampError("Niezgodny nonce w odpowiedzi usługi czasu.")
    gen = info["gen_time"].native
    if abs(gen - (now or datetime.now(UTC))) > MAX_SKEW:
        raise TimestampError(f"Czas ze znacznika ({gen:%Y-%m-%d %H:%M:%S}) odbiega od czasu serwera.")
    try:
        vc = ValidationContext(
            trust_roots=[ax509.Certificate.load(c) for c in roots] if roots else None,
            allow_fetching=False,
            revocation_mode="soft-fail",
            moment=gen,
        )
        kw = asyncio.run(validate_tst_signed_data(signed, vc, lambda _alg: digest))
        st = TimestampSignatureStatus(**kw)
    except Exception as exc:  # noqa: BLE001
        raise TimestampError("Nie udało się sprawdzić podpisu usługi czasu.") from exc
    if not (st.intact and st.valid):
        raise TimestampError("Podpis usługi czasu jest nieprawidłowy.")
    cert = st.signing_cert
    native = cert.subject.native if cert is not None else {}
    return {
        "gen_time": gen.isoformat(),
        "tsa": native.get("common_name") or native.get("organization_name"),
        "tsa_serial": str(info["tsa"].native) if info["tsa"].native else None,
        "trusted": bool(st.trusted) if roots else None,
        "token": base64.b64encode(token.dump()).decode(),
    }


def stamp_digest(
    hex_sha256: str,
    post: Callable[[str, bytes, float], bytes] | None = None,
    roots: list[bytes] | None = None,
) -> dict[str, Any]:
    """Prosi usługę czasu o znacznik dla skrótu i sprawdza odpowiedź."""
    digest = bytes.fromhex(hex_sha256)
    body, nonce = build_request(digest)
    url = get_settings().tsa_url.strip()
    try:
        resp = (post or _post)(url, body, get_settings().tsa_timeout)
    except Exception as exc:  # noqa: BLE001
        raise TimestampError(f"Brak połączenia z usługą czasu: {type(exc).__name__}") from exc
    out = check_response(resp, digest, nonce, roots if roots is not None else trust_roots())
    out["tsa_url"] = url
    return out


# ---------- dziennik ----------


def _latest_seals(db, since: datetime, doc_id: str | None = None) -> dict[str, str]:
    """Ostatni skrót podpisanego pliku każdego dokumentu (z pieczęci integralności)."""
    q = (
        select(AuditLog)
        .where(AuditLog.action == "document_sealed", AuditLog.ts >= since)
        .order_by(AuditLog.id)
    )
    out: dict[str, str] = {}
    for a in db.scalars(q):
        d = a.details or {}
        if doc_id is not None and d.get("document_id") != doc_id:
            continue
        if d.get("document_id"):
            out[d["document_id"]] = (
                d.get("signed_sha256") or ""
            )  # puste = brak podpisanego pliku (np. po usunięciu)
    return out


def _stamped(db, since: datetime) -> set[tuple[str, str]]:
    q = select(AuditLog).where(AuditLog.action == "document_timestamped", AuditLog.ts >= since)
    return {
        ((a.details or {}).get("document_id", ""), (a.details or {}).get("signed_sha256", ""))
        for a in db.scalars(q)
    }


def stamp_pending(
    doc_id: str | None = None, limit: int = 50, post: Callable | None = None
) -> tuple[int, int]:
    """Dodaje znaczniki do podpisanych dokumentów, które ich jeszcze nie mają. Zwraca (dodane, nieudane)."""
    if not enabled():
        return 0, 0
    since = datetime.now(UTC) - timedelta(days=90)
    done = failed = 0
    with SessionLocal() as db:
        seals = _latest_seals(db, since, doc_id)
        have = _stamped(db, since)
        todo = [(d, h) for d, h in seals.items() if h and (d, h) not in have][:limit]
    roots = trust_roots() if todo else None
    for d, h in todo:
        try:
            res = stamp_digest(h, post=post, roots=roots)
        except TimestampError:
            failed += 1
            continue
        with SessionLocal() as db:
            db.add(
                AuditLog(
                    username="system",
                    action="document_timestamped",
                    entity_type="document",
                    entity_id=d,
                    details={"document_id": d, "signed_sha256": h, **res},
                )
            )
            db.commit()
        done += 1
    return done, failed


def schedule(doc_id: str) -> None:
    """Uruchamia dodanie znacznika w tle (nie blokuje odpowiedzi do użytkownika)."""
    if not enabled():
        return
    threading.Thread(target=lambda: stamp_pending(doc_id), daemon=True).start()


def status(db, doc_id: str, signed_sha256: str | None) -> dict[str, Any] | None:
    """Znacznik dla bieżącego podpisanego pliku dokumentu (bez tokenu) albo None."""
    if not signed_sha256:
        return None
    q = (
        select(AuditLog)
        .where(AuditLog.action == "document_timestamped", AuditLog.entity_id == doc_id)
        .order_by(AuditLog.id.desc())
    )
    for a in db.scalars(q):
        d = a.details or {}
        if d.get("signed_sha256") == signed_sha256:
            return {k: d.get(k) for k in ("gen_time", "tsa", "tsa_url", "trusted", "tsa_serial")}
    return None


def token_for(db, doc_id: str, signed_sha256: str | None) -> tuple[bytes, str] | None:
    """Token DER (.tsr) bieżącego pliku i jego skrót (do niezależnej weryfikacji, np. openssl ts -verify)."""
    if not signed_sha256:
        return None
    q = (
        select(AuditLog)
        .where(AuditLog.action == "document_timestamped", AuditLog.entity_id == doc_id)
        .order_by(AuditLog.id.desc())
    )
    for a in db.scalars(q):
        d = a.details or {}
        if d.get("signed_sha256") == signed_sha256 and d.get("token"):
            return base64.b64decode(d["token"]), signed_sha256
    return None
