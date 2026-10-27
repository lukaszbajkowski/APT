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

## Dokumentacja

1. [Wymagania produktowe (PRD)](docs/01-product-requirements.md)
2. [Dokument techniczny (TRD)](docs/02-technical-requirements.md)
3. [Przepływy aplikacji](docs/03-app-flow.md)
4. [Design brief](docs/04-design-brief.md)
5. [Schemat backendu i bazy](docs/05-backend-schema.md)
6. [Plan wdrożenia](docs/06-implementation-plan.md)

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
- Pliki z danymi osobowymi na dysku (dokumenty, podpisy, skany, badania lekarskie, zdjęcia) są szyfrowane
  AES-256-GCM tym samym kluczem głównym. Stare pliki szyfrują się same przy pierwszym starcie po aktualizacji.
- **Kopia klucza `APT_DATA_KEY` musi być przechowywana bezpiecznie poza serwerem** – bez niego
  zaszyfrowanych numerów PESEL ani plików (dokumenty, skany, zdjęcia) nie da się odczytać, także z kopii zapasowej.

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
- Dokument dla kilku osób naraz: zaznacz pracowników na liście → „Dokument”. Wartości pól wspólne dla
  wszystkich albo osobno dla każdej osoby (przechodzą na kolejną osobę i można je zmienić); wynik to paczka
  ZIP (PDF albo Word, do 50 osób), a każdy dokument trafia też do profilu pracownika.
- Przykład: `examples/szablony/medicover_deklaracja.docx`.

## Retencja danych

- Dane zwolnionego pracownika są przechowywane 10 lat (`APT_RETENTION_YEARS`), licząc od końca roku
  kalendarzowego zwolnienia: zwolnienie w 2026 → przechowywanie do 31.12.2036.
- Nic nie usuwa się samo. Po terminie Administrator widzi przypomnienie na stronie startowej i w zakładce
  „Retencja danych” zaznacza osoby i usuwa je trwale (potwierdzenie słowem USUŃ): dane, PESEL, zdjęcie,
  wygenerowane dokumenty. W dzienniku zdarzeń zostaje tylko numer ewidencyjny i daty.
- Usunięcie można wstrzymać do wybranej daty z podaniem powodu (np. postępowanie sądowe).
- Usunięte dane znikają z kopii zapasowych po 14 dniach (rotacja kopii).

## Monitoring

```bash
/opt/apt/deploy/monitor-setup.sh     # adresy e-mail do powiadomień, cron co 5 min, e-mail testowy
/opt/apt/deploy/monitor.sh status    # stan teraz
```

Co 5 minut serwer sprawdza: odpowiedź `https://domena/api/health` (HTTPS, API i baza), działanie kontenerów,
zajętość dysku (próg 85%) i ważność certyfikatu (ostrzeżenie < 14 dni). Przy awarii wysyła e-mail
(po dwóch nieudanych sprawdzeniach z rzędu, żeby restart przy aktualizacji nie alarmował), przypomina
co 6 h i informuje o powrocie. E-maile idą bezpośrednio przez SMTP, bez udziału aplikacji.
Całkowitej niedostępności serwera (wyłączony VPS) serwer sam nie zgłosi – do tego zewnętrzny monitoring,
np. darmowy UptimeRobot sprawdzający `https://domena/api/health`.

## Raporty i eksport

- **Pracownicy → „Excel”** – lista z bieżącymi filtrami (.xlsx, nagłówki z filtrem, daty jako daty).
  Administrator i Kadry mogą świadomie dołączyć numery PESEL; Kierownik dostaje tylko swoich pracowników
  i wiek zamiast daty urodzenia. Każdy eksport (z filtrami i informacją o PESEL) trafia do dziennika.
- **Raporty** – aktywni wg APT, wydziałów, obywatelstwa, stanowisk, APT × wydział, zatrudnienia
  i zwolnienia w ostatnich 12 miesiącach; całość do pobrania jako zestawienie Excel (osobne arkusze).

## E-maile

Konfiguracja na serwerze (skrzynka pocztowa, np. `powiadomienia@aptid.pl` w hostingu home.pl):

```bash
/opt/apt/deploy/mail-setup.sh
```

Pyta o serwer SMTP, login i hasło skrzynki, zapisuje je w `.env`, restartuje aplikację i wysyła e-mail
testowy (przy błędzie przywraca poprzednie ustawienia). Potem:

- **„Nie pamiętasz hasła?”** na ekranie logowania – link do ustawienia nowego hasła (ważny 60 min,
  jednorazowy, najwyżej 3 na godzinę). Logowanie dwuetapowe nadal obowiązuje.
- **Nowe konto z adresem e-mail** – link do ustawienia hasła (72 h); Administrator może wysłać go ponownie
  (Użytkownicy → menu → „Wyślij link do ustawienia hasła”).
- **Powiadomienia o bezpieczeństwie** dla właściciela konta: zmiana hasła, blokada po nieudanych logowaniach,
  wyłączenie / reset 2FA.
- **Codziennie po kopii zapasowej** – administratorzy z adresem e-mail dostają wiadomość, jeśli kopia
  się nie udała albo są dane do usunięcia (retencja).

## Interfejs

- Strona startowa (kliknięcie w nazwę aplikacji): liczniki – aktywni, nowi, bez zdjęcia, bez PESEL, karty,
  archiwum – ostatnio dodani i szybkie akcje. Kierownik widzi tylko swoje wydziały.
- Motyw jasny, ciemny lub systemowy (menu konta); wybór zapamiętuje przeglądarka.
- Import z arkusza: Pracownicy → Dodaj pracownika → Importuj z arkusza.
- Skaner kart (menu „Skaner kart”): aparat telefonu odczytuje kod QR z karty i pokazuje zdjęcie, dane
  i status (aktywny / archiwum). Działa też wpisanie numeru ręcznie. Kierownik znajdzie tylko swoich
  pracowników; każde skanowanie trafia do dziennika zdarzeń.
- Użytkownicy: osobne zakładki dla aktywnych i wyłączonych kont.

## Role

| Rola | Opis |
|---|---|
| Administrator | wszystko, w tym użytkownicy, szablony i dziennik zdarzeń |
| Kadry | pełna kartoteka, karty i dokumenty |
| Kierownik | tylko przypisane wydziały |
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
`pliki.tar.gz`). Wynik ostatniej kopii (także błędy) Administrator widzi na stronie startowej.

### Kopie poza serwerem (FTP / SFTP, np. hosting home.pl)

```bash
/opt/apt/deploy/offsite-setup.sh
```

Pyta o serwer, użytkownika, hasło i katalog, sprawdza połączenie i wysyła pierwszą kopię. Od tej pory
codzienna kopia jest dodatkowo **szyfrowana (GPG, AES-256) i wysyłana**; na serwerze zdalnym zostaje
30 ostatnich dni. FTP działa tylko z szyfrowaniem TLS (FTPS). Na końcu skrypt wypisuje **hasło
szyfrowania kopii – zapisz je w menedżerze haseł** (bez niego kopii zdalnych nie da się odczytać).

| Co | Polecenie |
|---|---|
| lista kopii zdalnych | `/opt/apt/deploy/offsite.sh list` |
| pobranie i odszyfrowanie | `/opt/apt/deploy/offsite.sh fetch apt-RRRR-MM-DD_GGMM.tar.gpg` |
| test połączenia | `/opt/apt/deploy/offsite.sh test` |

Ręcznie na swój komputer (opcjonalnie): `rsync -a root@ADRES_SERWERA:/var/backups/apt/ ~/APT-kopie/`.

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

## Podpisy elektroniczne – zabezpieczenia

- **Ślad integralności:** każdy podpis zapisuje w dzienniku skróty SHA-256 plików; okno „Podpis” ostrzega, gdy plik został
  zmieniony poza aplikacją. Tokeny linków nie trafiają do logów, a publiczne adresy podpisu mają limit żądań na IP
  (`APT_SIGN_RATE_GET`, `APT_SIGN_RATE_POST`).
- **Potwierdzenie blokadą telefonu:** przy prośbie o podpis można wymagać Face ID, odcisku palca albo PIN-u telefonu
  (WebAuthn). Działa w Safari (iOS 16+) i Chrome na Androidzie, wymaga HTTPS i ustawionej blokady ekranu. Gdy telefon
  tego nie obsługuje, osoba wgrywa plik z podpisem zaufanym / kwalifikowanym albo kadry wysyłają nowy link bez wymogu.
- **Podpis kwalifikowany:** wgrany PDF jest sprawdzany (poprawność, brak zmian, treść, certyfikat z oznaczeniem
  „kwalifikowany” i wystawca z unijnej listy zaufania). Wynik widać w oknie „Podpis” i na stronie potwierdzenia.
  Aplikacja nie sprawdza unieważnienia certyfikatu ani podpisów XML. Listę zaufania odświeża cron w poniedziałki
  (ręcznie: `docker compose exec api python -m app.cli refresh-trustlist`); kraje: `APT_TRUST_COUNTRIES` (domyślnie `PL`).
