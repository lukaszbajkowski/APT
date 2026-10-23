# Identyfikacja pracowników APT

Aplikacja webowa do prowadzenia kartoteki pracowników agencji pracy tymczasowej,
druku kart identyfikacyjnych i generowania dokumentów z szablonów.

Specyfikacja MVP: https://claude.ai/artifact/XwKd3LZWNSmiApfLDFHhhZ

## Stan prac

| Etap | Zakres | Stan |
|---|---|---|
| 1. Fundament | repozytorium, Docker Compose, baza i migracje, logowanie, role, użytkownicy, dziennik zdarzeń | ✅ |
| 2. Kartoteka | słowniki, lista i filtry, profil, formularz, zaszyfrowany PESEL, zdjęcia | ✅ |
| 3. Import | Excel / CSV z podglądem błędów | ⏳ |
| 4. Karty | PDF, CR80, kod QR | ⏳ |
| 5. Dokumenty | szablony .docx, pola formularza | ⏳ |
| 6. Wdrożenie | VPS, HTTPS, kopie zapasowe, 2FA | ⏳ |

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

## Role

| Rola | Opis |
|---|---|
| Administrator | wszystko, w tym użytkownicy, szablony i dziennik zdarzeń |
| Kadry | pełna kartoteka, karty i dokumenty |
| Kierownik | tylko przypisane APT / wydziały |
| Podgląd | tylko odczyt, PESEL zamaskowany |

## Uruchomienie (serwer)

```bash
cp .env.example .env        # uzupełnij hasła, klucze i domenę
python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"   # wynik wpisz jako APT_DATA_KEY w .env
docker compose up -d --build
docker compose exec api python -m app.cli create-admin --username admin --full-name "Imię Nazwisko"
```

Polecenie wypisze hasło tymczasowe. Przy pierwszym logowaniu trzeba je zmienić.

## Praca lokalna

```bash
# baza
docker compose -f docker-compose.dev.yml up -d

# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export APT_DATABASE_URL=postgresql+psycopg://apt:apt@localhost:5432/apt APT_COOKIE_SECURE=false
export APT_DATA_KEY=...   # wygeneruj raz (python -m app.cli generate-key) i zachowaj – nowy klucz = nieczytelne stare PESEL-e
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
