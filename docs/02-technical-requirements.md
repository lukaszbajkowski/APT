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
backend/alembic/    migracje 0001–0027
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
- Pliki z danymi osobowymi na dysku (`photos/`, `documents/`, `trainings/`, `medical/`: dokumenty, podpisy, skany, badania, zdjęcia)
  są szyfrowane AES-256-GCM (`app/storage.py`, format `APTF` + nonce + szyfrogram z tagiem, losowy nonce na plik, zapis atomowy).
  Klucz wyprowadzany z `APT_DATA_KEY` (HKDF, osobny kontekst niż PESEL i TOTP). Stare jawne pliki są odczytywane bez zmian i
  szyfrowane przy starcie aplikacji (`python -m app.cli encrypt-files`, idempotentne). Szablony .docx (bez danych osobowych)
  i lista zaufania zostają jawne. Skróty w dzienniku (pieczęć integralności) liczone są z treści jawnej, więc dawne pieczęcie
  nadal się zgadzają; plik, którego nie da się odszyfrować, jest zgłaszany jako zmieniony.
- Zakończone pracownicy: retencja 10 lat od końca roku zwolnienia, trwałe usunięcie ręczne.
- Kopie: dzienne 14 dni lokalnie + szyfrowane GPG zdalnie (FTPS/SFTP) 30 dni.

## Kluczowe mechanizmy

**Dokumenty z szablonów.** Znaczniki Jinja w .docx są wykrywane automatycznie; dane z kartoteki wstawiane, reszta
staje się polami formularza. PDF przez LibreOffice.

**Podpisy.** Miejsce podpisu to znacznik `ZZ…ZZ` w PDF. Link (hash tokenu w bazie, ważność, limit prób) lub skan lub
podpis zaufany. Wynik: `{id}_signed.pdf` z dołączoną stroną potwierdzenia. `signed_file()` wybiera plik w kolejności:
zaufany PDF/XML → `_signed.pdf` → skan. `pypdfium2` z `init_forms()` rysuje pola formularza i podpisy gov.pl.

**Kilka kont w jednej przeglądarce.** Każde zalogowane konto ma własne ciasteczko sesji `apt_session_<id>`
(HttpOnly, SameSite=Strict, ścieżka `/api`), a `apt_session_active` wskazuje ostatnio użyte. Karta przeglądarki
wybiera konto nagłówkiem `X-APT-Account` (zapamiętanym w `sessionStorage`, więc dwie karty mogą działać na różnych
kontach); obrazy i pobrania, które nie mogą wysłać nagłówka, dostają `?acct=<id>`. Serwer sprawdza, że sesja z
ciasteczka należy do wskazanego konta – ciasteczko jednego konta nie otwiera drugiego. `GET /api/auth/accounts`
zwraca konta z ważną sesją (przełącznik w menu użytkownika, „Dodaj konto” otwiera logowanie bez wylogowania
bieżącego), wylogowanie dotyczy tylko bieżącego konta. Po wdrożeniu starsze ciasteczko `apt_session` przestaje
działać (jednorazowe ponowne logowanie).

**Konta pracowników (`routers/passkeys.py`).** Pracownik loguje się wyłącznie kluczem dostępu (WebAuthn) – bez hasła
i bez kodu 2FA; klucz z weryfikacją użytkownika (Face ID / odcisk / PIN) sam jest pełnym uwierzytelnieniem.
Kadry zapraszają pracownika (login `pr<numer>`, link ważny 7 dni, e-mail opcjonalny i niezapisywany – link można
przekazać inaczej). Pracownik potwierdza datę urodzenia i tworzy klucz (poświadczenie „discoverable”, weryfikacja
użytkownika wymagana, licznik użyć sprawdzany). Wyzwanie WebAuthn pobierane jest wcześniej, żeby okno klucza
otwierało się od razu po dotknięciu (wymóg Safari); okno wbudowane w komunikator jest wykrywane z instrukcją
otwarcia w przeglądarce. Odporność na utratę telefonu: kilka kluczy (na każdym urządzeniu; ostatniego klucza nie
można usunąć) oraz „Zresetuj dostęp” u kadr (usuwa klucze, kończy sesje, potem nowe zaproszenie, opcjonalny e-mail).
Aktywnego konta nie można zaprosić ponownie; link zaproszenia i link resetu hasła są rozdzielone
(`notify.find_token(employee_invite=…)`), logowanie hasłem dla roli `employee` jest zablokowane. Sesja roli
`employee` ma dostęp wyłącznie do `/api/auth/`, `/api/passkeys` i `/api/me/` (bramka w `deps._load_session`).
Kadry widzą konta w „Konta pracowników” (`GET /api/employee-accounts`) i w karcie pracownika. Konta admina i kadr
przed dodaniem klucza muszą ponownie podać hasło i kod z aplikacji, a po dodaniu dostają e-mail; hasło z kodem
zostaje ich zapasem. Kod 2FA ma wystawcę = domenę aplikacji.

**Potwierdzenie blokadą urządzenia (WebAuthn, `app/device.py`).** Kadry mogą przy prośbie o podpis zaznaczyć „Wymagaj
potwierdzenia blokadą telefonu”. Strona podpisu prosi wtedy przeglądarkę o utworzenie poświadczenia z
`userVerification: required` (Face ID, odcisk palca albo PIN telefonu); serwer sprawdza flagę „user verified”,
wyzwanie jest jednorazowe i związane z tym jednym podpisem. Ślad: id poświadczenia, czas i wpis w dzienniku oraz
na stronie potwierdzenia. Dowodzi odblokowania urządzenia, nie tożsamości; bez poświadczenia producenta (attestation).

**Weryfikacja podpisu kwalifikowanego (`app/qualified.py`, `app/trustlist.py`).** Przy wgraniu PDF z podpisem
(zakładka „Podpis zaufany lub kwalifikowany”) pyHanko sprawdza integralność i poprawność podpisu oraz brak zmian po
podpisaniu; porównujemy też treść z dokumentem. Poziomy: `qualified` (certyfikat z QcCompliance i łańcuch do urzędu z
unijnej listy zaufania EU LOTL → lista krajowa, domyślnie PL, `APT_TRUST_COUNTRIES`), `valid`, `unverified`, `invalid`
(odrzucany). Lista zaufania odświeżana w poniedziałki (`notify-daily`, `app.cli refresh-trustlist`). Podpisy RSA z DigestInfo bez parametrów NULL (tak podpisuje gov.pl;
biblioteka kryptograficzna to odrzuca) sprawdzamy własnym, równie rygorystycznym porównaniem bloku PKCS#1 (`lenient_pkcs1_ok`). Nie sprawdzamy
CRL/OCSP ani podpisu XML samej listy; XAdES (XML) nie jest weryfikowany.

**Hartowanie procesu podpisu (`app/hardening.py`, `signatures.py`).**
- Tokeny linków i klucze podglądu są maskowane w logach serwera (filtr na `uvicorn.access`).
- Pieczęć integralności: przy każdej zmianie podpisanego pliku (podpis, skan, usunięcie) do dziennika (tylko do
  dopisywania) trafia wpis `document_sealed` ze skrótami SHA-256 (oryginał, obraz podpisu, wgrany plik, plik końcowy).
  Okno „Podpis” porównuje bieżący plik z ostatnią pieczęcią i ostrzega, gdy plik zmieniono poza aplikacją.
- Blokada wiersza (`SELECT … FOR UPDATE`) tuż przed zapisem podpisu: jeden podpis na jeden link, także przy równoległych żądaniach.
- Zaufany znacznik czasu (`app/timestamp.py`, RFC 3161): po podpisaniu (i wgraniu skanu) aplikacja w tle wysyła do usługi
  czasu (domyślnie FreeTSA.org, `APT_TSA_URL`, pusty = wyłączone) wyłącznie skrót SHA-256 podpisanego pliku. Odpowiedź jest
  sprawdzana (status, zgodność skrótu i nonce, podpis usługi, czas w granicach 10 min od zegara serwera) i trafia jako token do
  dziennika (`document_timestamped`, tylko do dopisywania). Awaria usługi nie blokuje podpisu; brakujące znaczniki uzupełnia
  zadanie dzienne (`app.cli stamp-pending`). Zaufanie do urzędu usługi: certyfikat FreeTSA pobierany jednorazowo po HTTPS do
  `data/tsa-ca.pem`. Token do pobrania w oknie „Podpis” (.tsr). Znacznik darmowy nie jest kwalifikowany w rozumieniu eIDAS.
- Tryb ścisły szablonu (`templates.strict_pdf`, migracja 0023, opcja przy edycji szablonu): wgrany podpisany PDF musi
  zaczynać się od pobranego dokumentu bajt w bajt (podpis dopisany na końcu); inaczej odrzucenie. Domyślnie wyłączony,
  bo narzędzia, które przepisują cały plik, dawałyby odrzucenia legalnych podpisów.
- Limit żądań na IP dla `/api/sign/*`: `APT_SIGN_RATE_GET` (300/min) i `APT_SIGN_RATE_POST` (40/min), 0 = bez limitu;
  licznik w pamięci procesu (jeden proces API).

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
`APT_RETENTION_YEARS`, `APT_TSA_URL`, ustawienia SMTP (mail-setup.sh), opcjonalnie SMSAPI (token wpisywany ręcznie na serwerze).

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

- Utrata `APT_DATA_KEY` = utrata PESEL **i wszystkich zaszyfrowanych plików** (dokumenty, skany, zdjęcia); klucz i hasło kopii muszą być w menedżerze haseł, poza serwerem.
- Przy przetwarzaniu (podgląd, PDF z Worda przez LibreOffice) treść jawna istnieje chwilowo w pamięci i w katalogu tymczasowym; szyfrowanie chroni dane „w spoczynku” (dysk, kopie), nie przed osobą z dostępem do działającego serwera.
- Pojedynczy serwer: brak redundancji; ratunkiem są kopie zdalne.
- LibreOffice może inaczej złamać układ niż Word; szablony weryfikować w PDF.
- Podpis zaufany nie jest weryfikowany kryptograficznie, tylko przechowywany.
