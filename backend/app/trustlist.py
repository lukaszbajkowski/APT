"""Zaufane urzędy certyfikacji z unijnej listy zaufania (EU LOTL → lista krajowa, domyślnie PL).

Lista pobierana jest z internetu najwyżej raz na tydzień i trzymana w katalogu danych. Gdy pobranie się nie
uda, używamy ostatniej zapisanej wersji; bez niej łańcuch certyfikatów nie jest sprawdzany (wynik: nieznany).
Uwaga: nie weryfikujemy podpisu XML samej listy zaufania (zakładamy bezpieczne połączenie HTTPS z urzędem).
"""

import base64
import json
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from app.config import get_settings

LOTL_URL = "https://ec.europa.eu/tools/lotl/eu-lotl.xml"
MAX_AGE = 7 * 24 * 3600
QC_SERVICE = "/Svctype/CA/QC"
OK_STATUS = ("/granted", "/recognisedatnationallevel", "/accredited")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _fetch(url: str, timeout: float = 10) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "apt-id/1.0"})  # noqa: S310
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return r.read(30_000_000)


def tsl_locations(lotl: bytes, countries: list[str]) -> list[str]:
    """Adresy krajowych list zaufania z unijnej listy list."""
    root = ET.fromstring(lotl)  # noqa: S314
    out = []
    for ptr in root.iter():
        if _local(ptr.tag) != "OtherTSLPointer":
            continue
        loc = next((e.text for e in ptr.iter() if _local(e.tag) == "TSLLocation" and e.text), None)
        terr = next((e.text for e in ptr.iter() if _local(e.tag) == "SchemeTerritory" and e.text), None)
        if loc and terr and terr.strip().upper() in countries and loc.strip().lower().endswith(".xml"):
            out.append(loc.strip())
    return out


def qualified_cas(tsl: bytes) -> list[bytes]:
    """Certyfikaty (DER) urzędów wystawiających certyfikaty kwalifikowane, z aktualnym statusem."""
    root = ET.fromstring(tsl)  # noqa: S314
    out = []
    for svc in root.iter():
        if _local(svc.tag) != "ServiceInformation":
            continue
        kind = next((e.text for e in svc if _local(e.tag) == "ServiceTypeIdentifier"), "") or ""
        state = next((e.text for e in svc if _local(e.tag) == "ServiceStatus"), "") or ""
        if not kind.strip().endswith(QC_SERVICE) or not state.strip().lower().endswith(OK_STATUS):
            continue
        for e in svc.iter():
            if _local(e.tag) == "X509Certificate" and e.text:
                try:
                    out.append(base64.b64decode("".join(e.text.split())))
                except ValueError:
                    continue
    return out


def _cache_file() -> Path:
    return Path(get_settings().data_dir) / "trustlist.json"


def refresh() -> int:
    """Pobiera listę zaufania do cache; zwraca liczbę certyfikatów (przy błędzie sieci rzuca wyjątek)."""
    countries = [c.strip().upper() for c in get_settings().trust_countries.split(",") if c.strip()]
    certs: list[bytes] = []
    for url in tsl_locations(_fetch(LOTL_URL), countries):
        certs += qualified_cas(_fetch(url, timeout=20))
    path = _cache_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "at": time.time(),
                "countries": countries,
                "certs": [base64.b64encode(c).decode() for c in certs],
            }
        )
    )
    return len(certs)


_last_fail = 0.0


def load_roots(allow_fetch: bool = True) -> list[bytes] | None:
    """Zaufane urzędy (DER) albo None, gdy listy nie ma i nie udało się jej pobrać."""
    path = _cache_file()
    data = None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = None
    global _last_fail
    stale = data is None or time.time() - float(data.get("at", 0)) > MAX_AGE
    if stale and allow_fetch and time.time() - _last_fail > 3600:  # po błędzie nie ponawiamy przez godzinę
        try:
            refresh()
            data = json.loads(path.read_text())
        except Exception as exc:  # noqa: BLE001
            _last_fail = time.time()
            print(f"Nie udało się pobrać listy zaufania: {exc}")
    if not data or not data.get("certs"):
        return None
    return [base64.b64decode(c) for c in data["certs"]]
