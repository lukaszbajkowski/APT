# 6. Plan wdrożenia (Implementation plan)

## Stan na dziś

Etapy 1–6 z README oraz rozszerzenia (szkolenia, cykl życia, podpisy, symulacja ról, agencje pracy) są zrobione
i działają na produkcji po `aptid-aktualizuj`. Migracje do `0020_agencje`.

| Faza | Zakres | Migracje | Stan |
|---|---|---|---|
| 1. Fundament | repo, Docker, logowanie, role, użytkownicy, dziennik | 0001 | ✅ |
| 2. Kartoteka | słowniki, profil, PESEL, zdjęcia, archiwum | 0002 | ✅ |
| 3. Import | Excel / Numbers / CSV | – | ✅ |
| 4. Karty | PDF A4 / CR80, QR, skaner | 0007–0008 | ✅ |
| 5. Dokumenty | szablony .docx, pola, paczki ZIP | 0003–0004, 0010 | ✅ |
| 6. Wdrożenie | VPS, HTTPS, kopie, 2FA, monitoring, e-maile | 0005, 0006, 0009 | ✅ |
| 7. Szkolenia | rodzaje, katalog, opiekunowie, wymagania, braki, import | 0011–0014 | ✅ |
| 8. Cykl życia | przydziały, planowane zmiany, checklisty | 0015–0017 | ✅ |
| 9. Podpisy | ekran, skan, zaufany, podgląd w aplikacji, usuwanie | 0018 | ✅ |
| 10. Symulacja ról | administrator testuje uprawnienia | 0019 | ✅ |
| 11. Agencje pracy | zestawienia miesięczne, konto agencji, badania, zgłoszenia | 0020 | ✅ |
| 12. Podpisy – zabezpieczenia | potwierdzenie blokadą urządzenia (WebAuthn), weryfikacja podpisu kwalifikowanego, tryb ścisły szablonu | 0022–0023 | ✅ |
| 13. Szyfrowanie plików | AES-256-GCM dla dokumentów, podpisów, skanów, badań, zdjęć; migracja przy starcie | – | ✅ |
| 14. Znacznik czasu | RFC 3161 (FreeTSA) dla podpisanych dokumentów, token w dzienniku | – | ✅ |
| 15. Konta pracowników – etap A | rola `employee`, zaproszenie od kadr, klucze dostępu (WebAuthn), klucze dostępu (kilka urządzeń), reset dostępu przez kadry; bez haseł pracowników | 0024–0026 | ✅ |

## Plan: konta pracowników (do zatwierdzenia, bez kodu)

Decyzje właściciela: (1) obecna ścieżka bez konta zostaje – konto jest miękkim wymaganiem, nie przymusem; (2) zdjęcie, telefon
i e-mail pracownik zmienia sam od razu, pozostałe dane jako wniosek zatwierdzany przez kadry; (3) konta zakładają kadry
przez zaproszenie; (4) logowanie wyłącznie kluczem dostępu (Face ID / odcisk, WebAuthn), odzyskiwanie przez reset u kadr; (5) osoba z kontem
podpisuje dokumenty **tylko po zalogowaniu** (link do podpisu dla niej nie jest wystawiany), a o nowym dokumencie dostaje
powiadomienie (e-mail lub SMS) z odsyłaczem do konta.

| Etap | Zakres | Uwagi |
|---|---|---|
| A ✅ | Rola `employee`, powiązanie konta z kartoteką (`users.employee_id`), zaproszenie od kadr, logowanie wyłącznie kluczem dostępu (bez hasła i 2FA) | widzi wyłącznie własny rekord; migracje 0024–0026, tabela kluczy dostępu |
| B ✅ | „Moje dane”: podgląd własnych danych (PESEL zamaskowany, obywatelstwo) i historii zatrudnienia/stanowisk/wydziałów, własne zdjęcie, telefon i e-mail zapisywane po potwierdzeniu kodem (SMS / e-mail); kontakt szyfrowany, widoczny tylko dla administratora i kadr | migracja 0027, `routers/me.py`; imię, nazwisko, płeć, obywatelstwo zmieniają tylko kadry |
| B+ ✅ | „Napisz do kadr” (także w drugą stronę: kadry zaczynają rozmowę z pracownikiem mającym aktywne konto (przycisk „Napisz do pracownika” w jego karcie), własny temat, status „w toku”, powiadomienie e-mail/push bez treści): wątki pracownik ↔ kadry w aplikacji (temat z listy, status nowa / w toku / zakończona, odpowiedzi, powiadomienie e-mail bez treści, licznik nowych w menu kadr); bez załączników | migracja 0028, `routers/hr_messages.py` |
| C ✅ | Ścieżka bez konta: kadry wysyłają link „aktualizacja danych” (e-mail / SMS / kopiowanie; czeka na użycie 7 dni, po pierwszym potwierdzeniu daty urodzenia działa 15 minut, limit 5 prób); pracownik zmienia zdjęcie, telefon i e-mail (kontakt po kodzie) | migracja 0031, `routers/data_link.py`, strona `/aktualizacja`; bez podglądu PESEL i historii, kontakt widoczny zamaskowany |
| D ✅ | Podpis w koncie (ekran lub plik z podpisem zaufanym/kwalifikowanym, pobranie PDF): lista „Do podpisu” (z licznikiem), podgląd stron, podpis na ekranie po potwierdzeniu kluczem dostępu (Face ID / odcisk / PIN), powiadomienie e-mail lub SMS o nowym dokumencie; wyjątek kadr „wyślij link mimo konta” z wpisem w dzienniku | `routers/me_signatures.py`, `signatures.py` (kanał `konto`); osoby bez konta nadal podpisują linkiem, rola firmy zawsze linkiem |

Zasady: telefon i e-mail widzą tylko Administrator i Kadry; kontakt zapisywany szyfrowany (jak PESEL); każda zmiana w dzienniku
(bez wartości); odzyskanie dostępu przez kadry (nowe zaproszenie). Podstawa prawna, klauzula informacyjna i okres
przechowywania danych kontaktowych – do ustalenia przez właściciela z IOD lub prawnikiem.

Do potwierdzenia przed etapem D: czy kadry mają mieć wyjątek „wyślij link mimo konta” (np. po utracie telefonu, z wpisem w
dzienniku); domyślny kanał powiadomień (e-mail, a SMS tylko na życzenie, bo kosztuje); które „inne dane” obejmują wnioski na start.

## Zasady pracy nad kodem

1. Push na `main`, CI musi być zielone (ruff check, ruff format, pytest, build frontendu).
2. Każda zmiana modelu = migracja Alembic + test w `backend/tests/`.
3. Każda nowa trasa z danymi osobowymi: uprawnienia przez `require_roles` i `apply_scope`, wpis w `audit`.
4. Interfejs po polsku; nowe przyciski akcji przez `ActionButton`.
5. Zmiany w interfejsie sprawdzamy w przeglądarce (Playwright) przed commitem.
6. Sekretów (hasło root, `APT_DATA_KEY`, hasło kopii, hasła skrzynek, token SMSAPI) nikt nie przesyła do repozytorium ani do rozmów; wpisuje je właściciel na serwerze.

## Wdrożenie zmian na produkcję

```bash
aptid-aktualizuj        # kopia przed zmianą, pull, build, migracje, restart
/opt/apt/deploy/monitor.sh status
```

Po aktualizacji: sprawdzić Start, logowanie, jeden dokument z podglądem, zestawienie agencji.
Wycofanie: `/opt/apt/deploy/restore.sh /var/backups/apt/<kopia>`.

## Do zrobienia przed pełnym użyciem agencji

| # | Zadanie | Kto |
|---|---|---|
| 1 | Uzupełnić adresy e-mail agencji w Słownikach (zestawienie 1. dnia miesiąca) | Kadry |
| 2 | Założyć konta o roli Agencja i przypisać APT | Administrator |
| 3 | Skonfigurować SMTP (`mail-setup.sh`) i, jeśli SMS, konto SMSAPI + token | Administrator |
| 4 | Skonfigurować kopie zdalne (`offsite-setup.sh`) i zapisać hasło kopii | Administrator |
| 5 | Zewnętrzny monitoring (np. UptimeRobot na `/api/health`) | Administrator |
| 6 | Przetestować odtworzenie kopii na czystym serwerze | Administrator |

## Backlog

Wszystkie pozycje poprzedniego backlogu są zrobione:

| Pozycja | Gdzie |
|---|---|
| Kosz 30 dni dla usuniętych dokumentów (przywracanie, trwałe usunięcie po 30 dniach, migracja 0034) | karta „Dokumenty” → „Kosz” |
| Cotygodniowy e-mail o badaniach lekarskich (nieważne i kończące się w 30 dni) | `app.cli notify-medical`, poniedziałki |
| Wysyłka dokumentu e-mailem (wersja podpisana, jeśli jest; limit 20/h; wpis w dzienniku) | przycisk „E-mail” przy dokumencie |
| Przegląd uprawnień (role, zakres, ostatnie logowanie, 2FA, uwagi) | menu „Przegląd dostępu” (admin) |
| Raport dostępu do PESEL (kto, ile razy, ostatnie odsłonięcia) | menu „Przegląd dostępu” → „Dostęp do PESEL” |
| Zapisane filtry listy pracowników (w przeglądarce, osobno dla konta) | lista pracowników → „Zapisane filtry” |
| PWA: instalacja na telefonie (manifest, ikony, service worker bez cache) | – |
| Powiadomienia push (Web Push; jedna przeglądarka obsługuje kilka kont, migracje 0035–0036): nowy dokument do podpisu, odpowiedź kadr, nowa wiadomość od pracownika dla kadr, cotygodniowe przypomnienia (braki, szkolenia, badania) i alerty administratora (także bez e-maila); treść ogólna, klucze VAPID generowane automatycznie (`vapid.json`, migracja 0035) | „Moje konto” → „Powiadomienia na telefonie” |
| Cykliczny test odtwarzania kopii (niedziela, tymczasowa baza) | `deploy/restore-test.sh` |

Odrzucone: historia i ważność kart, adres i telefon w kartotece, sprawdzanie ukończenia szkolenia przez opiekuna.

## Ryzyka i środki zaradcze

| Ryzyko | Środek |
|---|---|
| Utrata `APT_DATA_KEY` | kopia w menedżerze haseł, poza serwerem |
| Awaria VPS | kopie dzienne + zdalne GPG, `restore.sh`, monitoring |
| Wyciek dokumentów z podglądu | znak wodny, brak pobierania dla kierownika, dziennik odczytów |
| Błędne usunięcie dokumentu | potwierdzenie; docelowo kosz |
| Rozbieżność szablonu Word i PDF | podgląd PDF przed użyciem szablonu |
| Błędy w zestawieniach agencji | testy na okresach i zmianach APT, kopia do kadr przy każdej wysyłce |


**Dodatkowo (v. październik 2026):** przycisk instalacji aplikacji na ekranie logowania (tylko telefon/tablet); kafelek „Ostatnio podpisany” na stronie głównej pracownika; link „aktualizacja danych” jednorazowy – po pierwszym zapisie działa jeszcze 10 minut, a przycisk „Gotowe – zakończ” zamyka go od razu (audyt `data_link_finished`).
