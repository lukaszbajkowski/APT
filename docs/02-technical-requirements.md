# 2. Dokument techniczny (TRD)

## Architektura

```
przeglądarka ──HTTPS──> Caddy ──┬── /api/*  ──> FastAPI (backend/) ──> PostgreSQL 16
                                └── reszta  ──> React (frontend/, pliki statyczne)
                                                 │
                                                 └── dysk: zdjęcia, szablony, dokumenty, skany, badania
```

Wszystko działa w Docker Compose na jednym VPS (home.pl, domena aptid.pl, katalog `/opt/apt`).

## Stos technologiczny

| Warstwa | Technologie |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, argon2 |
| Dokumenty | docxtpl (Jinja w .docx), LibreOffice (PDF), reportlab (karty, strony potwierdzeń; czcionka IBM Plex), pypdf, pypdfium2, pdfplumber |
| Dane | openpyxl (Excel), obsługa .numbers i CSV |
| Frontend | React 18, TypeScript, Vite, Mantine, TanStack Query, react-router |
| Baza | PostgreSQL 16 |
| Serwer | Caddy (HTTPS Let's Encrypt, nagłówki bezpieczeństwa), Docker Compose |
| CI | GitHub Actions: ruff check + format, pytest (z PostgreSQL), build frontendu |

## Struktura repozytorium

```
backend/app/        logika: models, schemas, deps (uprawnienia), signing, preview, cards,
                    agency_report, lifecycle, importer, mailer, sms, crypto, retention, cli
backend/app/routers/ 19 modułów API (auth, users, employees, documents, signatures, trainings,
                    lifecycle, agency_portal, agency_reports, reports, retention, audit_log ...)
backend/alembic/    migracje 0001–0021
backend/tests/      testy pytest (173)
frontend/src/       pages/ (strony), components/ (widoki wielokrotnego użytku), api.ts, auth
deploy/             Caddyfile, install.sh, backup.sh, restore.sh, offsite*.sh, monitor*.sh, mail-setup.sh
examples/           przykładowe szablony .docx
docs/               ten katalog
```

## Uwierzytelnianie i uprawnienia

- Sesja w ciasteczku `HttpOnly`, `Secure`, `SameSite=Strict`; w bazie skrót tokenu; 30 min bezczynności, max 12 h.
- CSRF: nagłówek `X-CSRF-Token` przy każdej zmianie.
- Hasła argon2id; blokada 15 min po 5 błędach; 2FA TOTP z kodami zapasowymi (sekret szyfrowany).
- Uprawnienia po stronie serwera: `require_roles(...)`, zakres danych `apply_scope` / `get_visible`
  (kierownik: wyłącznie wydziały z `user_scopes`; agencja: jedna APT z `users.agency_id`).
- Symulacja ról: `SimulatedUser` – prawdziwe konto, rola i zakres z sesji (`sim_*`).
- Dziennik `audit_log`: wyzwalacz w bazie blokuje UPDATE i DELETE.

## Ochrona danych

- PESEL: AES-256-GCM kluczem `APT_DATA_KEY` (poza bazą), `pesel_hash` (HMAC) do wykrywania duplikatów, `pesel_last2`.
- Odczyt pełnego PESEL tylko Administrator i Kadry, każdy zapisany w dzienniku.
- Zdjęcia: JPEG 600×800 bez metadanych. Pliki na dysku, w bazie tylko opis.
- Zakończone pracownicy: retencja 10 lat od końca roku zwolnienia, trwałe usunięcie ręczne.
- Kopie: dzienne 14 dni lokalnie + szyfrowane GPG zdalnie (FTPS/SFTP) 30 dni.

## Kluczowe mechanizmy

**Dokumenty z szablonów.** Znaczniki Jinja w .docx są wykrywane automatycznie; dane z kartoteki wstawiane, reszta
staje się polami formularza. PDF przez LibreOffice.

**Podpisy.** Miejsce podpisu to znacznik `ZZ…ZZ` w PDF. Link (hash tokenu w bazie, ważność, limit prób) lub skan lub
podpis zaufany. Wynik: `{id}_signed.pdf` z dołączoną stroną potwierdzenia. `signed_file()` wybiera plik w kolejności:
zaufany PDF/XML → `_signed.pdf` → skan. `pypdfium2` z `init_forms()` rysuje pola formularza i podpisy gov.pl.

**Podgląd w aplikacji.** Strony renderowane po stronie serwera do obrazów ze znakiem wodnym (imię, czas); brak pobierania
dla kierownika; zrzutów ekranu nie da się zablokować w przeglądarce całkowicie.

**Cykl życia.** `assignments` (historia APT/wydział/stanowisko), `employment_periods` (wcześniejsze okresy),
`planned_changes` (stosowane przez zadanie dzienne), checklisty z `auto` (`photo`, `card`, `training:<id>`, `document:<id>`,
`signed:<id>`).

**Zestawienia agencji.** `agency_report.rows_for` łączy bieżące zatrudnienie, okresy i przydziały; Excel przez openpyxl;
`send_monthly` (polecenie `agency-reports`, wołane 1. dnia miesiąca z `notify_daily`) nie wysyła drugi raz za ten sam miesiąc (sprawdza dziennik).

**Zadania cykliczne.** CLI `python -m app.cli notify-daily` wywoływane przez `deploy/backup.sh` (cron 2:30): planowane zmiany, przypomnienia
(poniedziałki), zestawienia agencji (1. dnia miesiąca), alerty dla administratorów.

## Konfiguracja (zmienne środowiskowe)

`APT_DATABASE_URL`, `APT_SECRET_KEY`, `APT_DATA_KEY`, `APT_DATA_DIR`, `APT_COOKIE_SECURE`, `APT_DOMAIN`,
`APT_RETENTION_YEARS`, ustawienia SMTP (mail-setup.sh), opcjonalnie SMSAPI (token wpisywany ręcznie na serwerze).

## Wdrożenie i operacje

| Czynność | Polecenie |
|---|---|
| instalacja | `deploy/install.sh domena` |
| aktualizacja z kopią | `aptid-aktualizuj` (pull, build, migracje) |
| kopia / odtworzenie | `deploy/backup.sh`, `deploy/restore.sh` |
| monitoring | `deploy/monitor-setup.sh` (co 5 min, e-mail przy awarii) |

Push na `main` uruchamia CI; produkcja aktualizowana ręcznie po zielonym CI.

## Testy i jakość

pytest na prawdziwym PostgreSQL (`apt_test`, tabele czyszczone TRUNCATE), ruff (linia ≤ 110), build TypeScript w CI,
scenariusze Playwright uruchamiane lokalnie przy zmianach interfejsu.

## Wydajność

- Frontend: strony rzadziej używane ładowane leniwie (`React.lazy`), biblioteki w osobnych pakietach (`react`, `mantine`).
  Pierwszy pakiet: 987 kB (303 kB gzip) → ok. 680 kB (ok. 208 kB gzip); skaner QR (jsqr, 136 kB) ładuje się dopiero w skanerze.
- Caddy: kompresja zstd/gzip, pliki `/assets/*` z `Cache-Control: immutable` na rok, `index.html` z `no-cache`.
- Baza: pula połączeń 10 + 10 w szczycie, odnawiana co 30 min; indeksy na kluczach obcych, statusie i datach ważności.
- Już wcześniej: paginacja listy pracowników, opóźnienie wyszukiwania 300 ms, zdjęcia z `loading="lazy"` i cache przeglądarki 24 h.
- Świadomie pominięte: CDN i load balancer (jeden serwer, kilkunastu użytkowników), cache po stronie serwera (dane muszą być zawsze aktualne).

## Ryzyka techniczne

- Utrata `APT_DATA_KEY` = utrata PESEL; klucz i hasło kopii muszą być w menedżerze haseł.
- Pojedynczy serwer: brak redundancji; ratunkiem są kopie zdalne.
- LibreOffice może inaczej złamać układ niż Word; szablony weryfikować w PDF.
- Podpis zaufany nie jest weryfikowany kryptograficznie, tylko przechowywany.
