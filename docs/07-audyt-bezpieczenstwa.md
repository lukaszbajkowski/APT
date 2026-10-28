# Audyt bezpieczeństwa – 28.10.2026

Zakres: kod backendu (FastAPI) i frontendu (React), konfiguracja wdrożenia (Docker Compose, Caddy, skrypty
`deploy/`), zależności. Metody: przegląd kodu, skanery (bandit, pip-audit), test macierzy uprawnień
(`backend/tests/test_authz_matrix.py`), próby ataków na publiczne adresy.

## Poprawione w tym audycie

| # | Waga | Ustalenie | Poprawka |
|---|------|-----------|----------|
| 1 | wysoka | **SSRF w powiadomieniach push** – dowolne zalogowane konto (także pracownik) mogło zapisać „urządzenie” pod adresem `https://…` i kazać serwerowi łączyć się z tym adresem (także wewnętrznym); przycisk „Wyślij testowe” zwracał początek odpowiedzi. | Dozwolone tylko adresy usług push przeglądarek (Google FCM, Mozilla, Apple, Windows); testy z adresami wewnętrznymi i podszywaniem się pod domenę. |
| 2 | wysoka | **Szablony Worda renderowane bez piaskownicy Jinja** – autor szablonu (administrator) mógł wykonać kod na serwerze (`{{ cycler.__init__.__globals__… }}`). | Renderowanie w `SandboxedEnvironment`; test z próbą ucieczki. |
| 3 | wysoka | **Znane luki w Starlette 0.48** (12 wpisów PYSEC; m.in. Range w FileResponse, walidacja Host/ścieżki, limity formularzy multipart). Aplikacja nie używa większości zagrożonych funkcji, ale wersja była przypięta przez `fastapi<0.120`. | FastAPI ≥ 0.160 i Starlette ≥ 1.3.1; pip-audit: brak znanych luk; 258 testów przechodzi. |
| 4 | średnia | **Brak limitu prób logowania na adres IP** – blokada działa tylko per konto (5 prób), więc „spryskiwanie” haseł po wielu loginach i masowe żądania resetu hasła były nieograniczone; zablokowanie konta cudzymi próbami było łatwe. | Limit 30 zapisów/min/IP dla logowania, resetu hasła, zaproszeń, kluczy dostępu i kodu 2FA (`APT_AUTH_RATE_POST`). |
| 5 | niska | **Publiczna dokumentacja API** (`/api/docs`, `/api/openapi.json`) ujawniała pełną mapę adresów. | Domyślnie wyłączona (`APT_ENABLE_DOCS=true` tylko lokalnie). |
| 6 | niska | Domyślny/krótki `APT_SECRET_KEY` nie był zgłaszany. | Ostrzeżenie w logach przy starcie (instalator generuje 96 znaków). |

## Sprawdzone i w porządku

- **Zakres uprawnień:** kierownik z innego wydziału, agencja z innej agencji, konto podglądu i konto pracownika próbują
  ok. 40 adresów dotyczących cudzego pracownika, dokumentu i szkolenia (odczyt i zapis) – żaden nie zwraca ani nie
  zmienia danych; listy, raporty i xlsx nie zawierają osób spoza zakresu.
- **Konto administratora:** zarządzanie użytkownikami, dziennik zdarzeń, retencja i przegląd dostępu tylko dla roli
  admin; symulacja ról tylko dla prawdziwego administratora.
- **Sesje:** ciasteczka `HttpOnly`, `Secure`, `SameSite=Strict`, ścieżka `/api`; token w bazie tylko jako skrót; CSRF
  (nagłówek zgodny z sesją) dla każdej zmiany; wygasanie przy bezczynności i po maks. czasie; reset hasła unieważnia sesje.
- **Hasła i 2FA:** Argon2, minimalna długość 12, blokada konta po 5 próbach, 2FA obowiązkowe dla admina i kadr,
  konta pracowników bez hasła (tylko klucz dostępu).
- **Publiczne linki:** tokeny 256-bitowe (`secrets.token_urlsafe(32)`), w bazie skrót, maskowane w logach; druga
  weryfikacja datą urodzenia z limitem 5 prób; limit żądań na IP; link do danych jednorazowy.
- **Dane wrażliwe:** PESEL szyfrowany, pliki szyfrowane na dysku, telefon/e-mail szyfrowane; maskowanie PESEL dla ról
  bez uprawnień; wyświetlenie raportu PESEL zapisywane w dzienniku.
- **Wgrywanie plików:** limity rozmiaru, nazwy plików na dysku generowane przez serwer (brak path traversal), limit
  pikseli obrazów, nazwy w nagłówkach oczyszczane.
- **Wstrzyknięcia:** brak SQL składanego z danych użytkownika (SQLAlchemy z parametrami); frontend bez `eval`,
  `innerHTML` tylko dla SVG z kodem QR generowanym przez serwer.
- **Wdrożenie:** Caddy (HTTPS, HSTS, CSP, `X-Frame-Options: DENY`, `nosniff`), kontener API bez roota, baza tylko w sieci
  wewnętrznej, `ufw` (22/80/443), `fail2ban`, logowanie roota tylko kluczem, `.env` z prawami 600, kopie szyfrowane (gpg).

## Zalecenia (niepilne)

1. Dodać do CI `pip-audit` i `npm audit --omit=dev` (w tym środowisku nie dało się uruchomić `npm audit` – brak dostępu do
   rejestru; uruchom lokalnie: `cd frontend && npm audit --omit=dev`).
2. Rozważyć blokadę konta także po adresie IP lub CAPTCHA – obecnie obcy może zablokować cudze konto na 15 min
   (dla admina i kadr mitigowane drugim składnikiem, ale blokada nadal działa).
3. Komunikat „konto zablokowane” ujawnia, że login istnieje (enumeracja loginów) – można ujednolicić z komunikatem
   o błędnych danych.
4. `defusedxml` do parsowania listy zaufania UE (dane z oficjalnego, stałego adresu – ryzyko niskie).
5. Raz na kwartał: aktualizacja zależności (`aptid-aktualizuj` przebudowuje obraz) i przegląd kont w „Przeglądzie dostępu”.
