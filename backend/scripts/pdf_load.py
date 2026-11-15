"""Test obciążenia podglądu PDF (tylko lokalne demo – loguje się kontem admin z demo):
uruchom: python scripts/pdf_load.py 1,5,10,20,40  (liczby osób naraz)
 N równoległych „osób” otwiera podgląd i pobiera wszystkie strony;
w tym samym czasie co 0,5 s sprawdzamy, jak szybko odpowiada zwykły endpoint (lista pracowników)."""
import os
import statistics
import sys
import threading
import time

import httpx

BASE = "http://localhost:8000/api"


_login: dict = {}


def session() -> httpx.Client:
    """Jedno logowanie na cały test (logowanie ma limit prób); każdy wątek ma własnego klienta z tą sesją."""
    if not _login:
        c = httpx.Client(base_url=BASE, timeout=120)
        r = c.post("/auth/login", json={"username": "admin", "password": os.environ.get("APT_UI_PASSWORD", "")})
        r.raise_for_status()
        _login["cookies"] = dict(c.cookies)
        _login["csrf"] = r.json()["csrf_token"]
    c = httpx.Client(base_url=BASE, timeout=120, cookies=_login["cookies"])
    c.headers["X-CSRF-Token"] = _login["csrf"]
    return c


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else 0


def run(users: int, docs: list[str]) -> dict:
    page_t, doc_t, errs = [], [], []
    probe_t: list[float] = []
    stop = threading.Event()

    def person(i: int) -> None:
        c = session()
        doc = docs[i % len(docs)]
        t0 = time.perf_counter()
        try:
            meta = c.get(f"/documents/{doc}/preview").json()
            for p in range(meta["pages"]):
                t = time.perf_counter()
                r = c.get(f"/documents/{doc}/preview/{p}")
                if r.status_code != 200:
                    errs.append(r.status_code)
                page_t.append(time.perf_counter() - t)
        except Exception as e:  # noqa: BLE001
            errs.append(type(e).__name__)
        doc_t.append(time.perf_counter() - t0)

    def probe() -> None:
        c = session()
        while not stop.is_set():
            t = time.perf_counter()
            c.get("/employees?limit=50")
            probe_t.append(time.perf_counter() - t)
            time.sleep(0.5)

    pr = threading.Thread(target=probe)
    pr.start()
    ths = [threading.Thread(target=person, args=(i,)) for i in range(users)]
    t0 = time.perf_counter()
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    total = time.perf_counter() - t0
    stop.set()
    pr.join()
    return {
        "users": users,
        "pages": len(page_t),
        "page_p50": statistics.median(page_t) if page_t else 0,
        "page_p95": pct(page_t, 95),
        "doc_max": max(doc_t) if doc_t else 0,
        "total": total,
        "errors": errs,
        "probe_p50": statistics.median(probe_t) if probe_t else 0,
        "probe_max": max(probe_t) if probe_t else 0,
    }


if __name__ == "__main__":
    c = session()
    emp = c.get("/employees?limit=50").json()["items"]
    docs: list[str] = []
    for e in emp:
        for d in c.get(f"/employees/{e['id']}/documents").json():
            docs.append(d["id"])
        if len(docs) >= 20:
            break
    pages = c.get(f"/documents/{docs[0]}/preview").json()["pages"]
    print(f"dokumentów: {len(docs)}, stron w pierwszym: {pages}")
    for n in [int(x) for x in (sys.argv[1] if len(sys.argv) > 1 else "1,5,10,20").split(",")]:
        r = run(n, docs)
        print(
            f"{r['users']:>3} osób | stron {r['pages']:>4} | strona p50 {r['page_p50']:.2f} s, p95 {r['page_p95']:.2f} s"
            f" | cały dokument max {r['doc_max']:.1f} s | razem {r['total']:.1f} s"
            f" | lista pracowników w tym czasie: p50 {r['probe_p50']:.2f} s, max {r['probe_max']:.2f} s"
            f" | błędy {r['errors'] or 'brak'}"
        )
