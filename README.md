# Identyfikacja pracowników APT

Aplikacja webowa do prowadzenia kartoteki pracowników agencji pracy tymczasowej,
druku kart identyfikacyjnych i generowania dokumentów z szablonów.

Specyfikacja MVP: https://claude.ai/artifact/XwKd3LZWNSmiApfLDFHhhZ

## Stan prac

| Etap | Zakres | Stan |
|---|---|---|
| 1. Fundament | repozytorium, Docker Compose, baza i migracje, logowanie, role, użytkownicy, dziennik zdarzeń | ✅ |
| 2. Kartoteka | słowniki, lista i filtry, profil, formularz, zaszyfrowany PESEL, zdjęcia | ✅ |
| 3. Import | Excel / Numbers / CSV z podglądem błędów | ✅ |
| 4. Karty | PDF, CR80, kod QR | ✅ |
| 5. Dokumenty | szablony .docx, pola formularza | ✅ |
| 6. Wdrożenie | VPS, HTTPS, kopie zapasowe, 2FA | ✅ |

## Architektura

```
przeglądarka ──HTTPS──> Caddy ──┬── /api/*  ──> FastAPI (backend/) ──> PostgreSQL 16
                                └── reszta  ──> React (frontend/, pliki statyczne)
```

- **backend/** – Python 3.12, FastAPI, SQLAlchemy 2, Alembic, argon2
- **frontend/** – React 18 + TypeScript, Vite, Mantine, TanStack Query
- **deploy/** – Caddyfile (HTTPS, nagłówki bezpieczeństwa), obraz frontendu

## Bezpieczeństwo (etap 1)

- Hasła: argon2id, min. 12 znaków z 3 z 4 grup, bez loginu w haśle.
- Blokada konta po 5 nieudanych logowaniach na 15 minut (administrator może odblokować).
- Sesja w ciasteczku `HttpOnly`, `Secure`, `SameSite=Strict`; w bazie tylko skrót tokenu.
- Wylogowanie po 30 min bezczynności, najdłużej 12 h.
- Ochrona CSRF: nagłówek `X-CSRF-Token` wymagany dla każdej zmiany danych.
- Nowe konto i reset hasła: hasło tymczasowe, zmiana wymuszona przy pierwszym logowaniu.
- Dziennik zdarzeń tylko do dopisywania (UPDATE/DELETE zablokowane wyzwalaczem w bazie).
- Logowanie dwuetapowe (TOTP, np. Google / Microsoft Authenticator): obowiązkowe dla Administratora i Kadr,
  opcjonalne dla pozostałych. 10 jednorazowych kodów zapasowych, kod nie może być użyty dwa razy, błędne
  kody liczą się do blokady konta. Sekret szyfrowany kluczem `APT_DATA_KEY`. Administrator może zresetować
  2FA innej osoby (Użytkownicy → menu); własne – poleceniem
  `docker compose exec api python -m app.cli reset-mfa --username LOGIN` na serwerze.
- Role sprawdzane po stronie serwera; nie da się odebrać sobie roli administratora
  ani wyłączyć ostatniego aktywnego administratora.

## Kartoteka (etap 2)

- Numer ewidencyjny nadawany automatycznie z sekwencji bazy (000001, 000002, …), niezmienny.
- PESEL szyfrowany AES-256-GCM kluczem `APT_DATA_KEY` trzymanym poza bazą; do wykrywania
  duplikatów służy skrót HMAC. Pełny numer widzą tylko Administrator i Kadry, po kliknięciu
  „Pokaż” – każdy odczyt trafia do dziennika zdarzeń.
- PESEL sprawdzany (suma kontrolna, data, płeć) i sam uzupełnia datę urodzenia i płeć.
- Duplikaty: ten sam PESEL blokuje zapis; to samo imię, nazwisko i data urodzenia wymaga potwierdzenia.
- Zdjęcia: plik lub kamera, kadrowanie 3:4, serwer zapisuje JPEG 600×800 do ok. 200 KB bez metadanych.
- Zwolnienie przenosi do archiwum (z datą), rekord zostaje; można go przywrócić.
- Historia zmian w profilu – dla danych osobowych zapisywana jest tylko informacja, że pole się zmieniło.
- **Kopia klucza `APT_DATA_KEY` musi być przechowywana bezpiecznie poza serwerem** – bez niego
  zaszyfrowanych numerów PESEL nie da się odczytać.

## Import z Excela / CSV (etap 3)

- Pliki: Excel (.xlsx), Numbers z macOS (.numbers), CSV.
- Kreator: plik → przypisanie kolumn (proponowane automatycznie po nazwach nagłówków) → podgląd → zapis.
- Rozpoznaje m.in. „Nazwisko i imię” w jednej kolumnie, daty w kilku formatach, płeć K/M lub słownie,
  obywatelstwo jako nazwę kraju, kod ISO lub przymiotnik („ukraińskie”), PESEL bez zera na początku
  (Excel je obcina).
- Każdy wiersz dostaje status: do importu / pominięty (już w kartotece) / błąd z opisem.
- Brakujące APT, wydziały i stanowiska mogą zostać dodane do słowników (opcja w kreatorze).
- Zapis wszystkich wierszy w jednej transakcji; w dzienniku wpis dla każdej osoby i podsumowanie importu.
- Szablon .xlsx do pobrania w kreatorze.

## Karty identyfikacyjne (etap 4)

- Wariant A: granatowy pasek „Identyfikator pracownika” (opcjonalnie data ważności), zdjęcie,
  nazwisko i imię, APT, wydział, kod QR z numerem ewidencyjnym. Bez PESEL.
- Dwa układy PDF: arkusz A4 z 10 kartami 85,6 × 54 mm i znacznikami cięcia
  albo jedna karta na stronę w formacie CR80 (drukarki kart PVC).
- Druk z profilu pracownika albo seryjnie z listy (zaznaczanie, także „wszystkie wyniki” filtra).
- Przed drukiem ostrzeżenie o osobach bez zdjęcia; każdy wydruk trafia do dziennika i historii pracownika.
- Długie nazwiska dwuczłonowe przechodzą do drugiej linii zamiast być obcinane.
- Czcionka IBM Plex (licencja SIL OFL, `backend/app/assets/fonts/OFL.txt`) osadzona w PDF.

## Dokumenty z szablonów (etap 5)

- Administrator wgrywa szablon Word (.docx) ze znacznikami Jinja: `{{ nazwisko_imie }}`, `{% if … %}`,
  `{{ '☒' if wariant == 'rodzinny' else '☐' }}`.
- Aplikacja sama rozpoznaje znaczniki: dane z kartoteki (lista w „Ściądze znaczników”) wstawia automatycznie,
  pozostałe zamienia w pola formularza. Z porównań `pole == 'wartość'` tworzy listy wyboru.
- Pola można opisać, zmienić typ (tekst, data, lista, tak/nie, liczba), oznaczyć jako wymagane i ułożyć.
- Nowa wersja pliku zachowuje ustawienia pól; poprzednie wersje zostają na dysku.
- Generowanie z profilu pracownika: Word i PDF (LibreOffice w kontenerze API), lista dokumentów w profilu.
- Każdy dokument można obejrzeć online (PDF w nowej karcie). W ustawieniach szablonu: formaty do pobrania
  (PDF, Word albo oba) oraz „Dostępny dla kierownika”.
- Kierownik generuje dokumenty z szablonów z PESEL/datą urodzenia, ale te pola zostają puste; dokumentów
  z tymi danymi (wygenerowanych przez Kadry) nie zobaczy ani nie pobierze.
- Generowanie, podgląd i pobranie trafiają do dziennika zdarzeń.
- Przykład: `examples/szablony/medicover_deklaracja.docx`.

## Interfejs

- Strona startowa (kliknięcie w nazwę aplikacji): liczniki – aktywni, nowi, bez zdjęcia, bez PESEL, karty,
  archiwum – ostatnio dodani i szybkie akcje. Kierownik widzi tylko swoje APT / wydziały.
- Motyw jasny, ciemny lub systemowy (menu konta); wybór zapamiętuje przeglądarka.
- Import z arkusza: Pracownicy → Dodaj pracownika → Importuj z arkusza.
- Użytkownicy: osobne zakładki dla aktywnych i wyłączonych kont.

## Role

| Rola | Opis |
|---|---|
| Administrator | wszystko, w tym użytkownicy, szablony i dziennik zdarzeń |
| Kadry | pełna kartoteka, karty i dokumenty |
| Kierownik | tylko przypisane APT / wydziały |
| Podgląd | tylko odczyt, PESEL zamaskowany |

## Uruchomienie na własnym komputerze (Docker)

Wymagane: Git i Docker Desktop.

```bash
git clone https://github.com/lukaszbajkowski/APT.git
cd APT
cp .env.example .env            # Windows: copy .env.example .env
```

W pliku `.env` ustaw:

```
APT_DOMAIN=:80
APT_COOKIE_SECURE=false
POSTGRES_PASSWORD=<litery i cyfry>
APT_SECRET_KEY=<losowy ciąg>
APT_DATA_KEY=<klucz z polecenia poniżej>
```

Klucz `APT_DATA_KEY` (jednorazowo, potem go nie zmieniaj):

```bash
docker run --rm python:3.12-slim python -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"
```

Start i pierwszy administrator:

```bash
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --username admin --full-name "Imię Nazwisko"
```

Aplikacja: http://localhost (albo http://localhost:8080 przy `APT_HTTP_PORT=8080`).

| Co | Polecenie |
|---|---|
| zatrzymanie / start | `docker compose stop` / `docker compose start` |
| aktualizacja kodu | `git pull` i `docker compose up -d --build` |
| logi | `docker compose logs -f api` |
| stan kontenerów | `docker compose ps` |
| usunięcie wszystkiego **razem z danymi** | `docker compose down -v` |

## Uruchomienie na serwerze (Ubuntu 24.04)

1. W panelu domeny ustaw rekordy A dla `twoja-domena.pl` i `www.twoja-domena.pl` na adres IP serwera.
2. Zaloguj się na serwer jako root i uruchom:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/lukaszbajkowski/APT/main/deploy/install.sh) twoja-domena.pl
   ```

Skrypt `deploy/install.sh`: aktualizuje system (i włącza automatyczne poprawki bezpieczeństwa), dodaje swap,
instaluje Dockera, włącza zaporę (22, 80, 443) i fail2ban, wyłącza logowanie SSH hasłem (jeśli jest klucz),
pobiera aplikację do `/opt/apt`, tworzy `.env` z losowymi hasłami, uruchamia aplikację z certyfikatem
Let's Encrypt, ustawia codzienną kopię zapasową i tworzy pierwszego administratora.
Na końcu wypisuje **klucz `APT_DATA_KEY` – zapisz go w menedżerze haseł**.

| Co | Polecenie (na serwerze) |
|---|---|
| aktualizacja aplikacji (z kopią przed) | `aptid-aktualizuj` |
| kopia zapasowa teraz | `/opt/apt/deploy/backup.sh` |
| lista kopii | `ls /var/backups/apt` |
| odtworzenie kopii | `/opt/apt/deploy/restore.sh /var/backups/apt/RRRR-MM-DD_GGMM` |
| logi | `cd /opt/apt && docker compose logs -f api` |

Kopie: codziennie o 2:30 do `/var/backups/apt`, przechowywane 14 dni (baza `baza.dump` + pliki
`pliki.tar.gz`). Trzymaj też kopię poza serwerem, np. na swoim komputerze:

```bash
rsync -a root@ADRES_SERWERA:/var/backups/apt/ ~/APT-kopie/
```

## Praca nad kodem (bez Dockera dla API)

```bash
# baza
docker compose -f docker-compose.dev.yml up -d

# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export APT_DATABASE_URL=postgresql+psycopg://apt:apt@localhost:5432/apt APT_COOKIE_SECURE=false
export APT_DATA_KEY=...   # wygeneruj raz (python -m app.cli generate-key) i zachowaj
alembic upgrade head
python -m app.cli create-admin --username admin --full-name "Admin Lokalny"
uvicorn app.main:app --reload

# frontend (drugi terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Testy backendu (używają bazy `apt_test`):

```bash
cd backend && pytest
```

Dokumentacja API: http://localhost:8000/api/docs
