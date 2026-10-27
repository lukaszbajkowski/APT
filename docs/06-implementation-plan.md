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

## Backlog (propozycje bez decyzji)

| Priorytet | Pomysł | Uwagi |
|---|---|---|
| Wysoki | Kosz 30 dni dla usuniętych dokumentów | usunięcia są dziś trwałe |
| Wysoki | Cotygodniowy e-mail o kończących się badaniach | dane już są w `medical_exams.valid_until` |
| Średni | Wysyłka dokumentu e-mailem | użyć `mailer` z załącznikami |
| Średni | Przegląd uprawnień (kto ma jaką rolę, kiedy ostatnio logował) | widok z `users` + `audit_log` |
| Średni | Raport dostępu do PESEL | z `audit_log` |
| Niski | Zapisane filtry listy | |
| Niski | PWA / instalacja na telefonie | skaner i podpis |
| Niski | Cykliczny, zautomatyzowany test odtwarzania kopii | |

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
