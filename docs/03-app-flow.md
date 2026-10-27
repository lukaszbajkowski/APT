# 3. Przepływy aplikacji (App flow)

## Mapa ekranów

| Ścieżka | Ekran | Role |
|---|---|---|
| `/login`, `/reset-hasla`, `/ustaw-haslo`, `/zmiana-hasla`, MFA | logowanie i hasło | wszyscy |
| `/` | Start: liczniki, najbliższe 14 dni, szybkie akcje | wszyscy |
| `/pracownicy` | lista z filtrami, druk kart, dokument zbiorczy, Excel | wszyscy (zakres wg roli) |
| `/pracownicy/nowy` | nowy pracownik | admin, kadry |
| `/pracownicy/:id/edycja` | edycja | admin, kadry, kierownik (w swoim zakresie) |
| `/pracownicy/:id` | profil: dane, zdjęcie, dokumenty, szkolenia, badania, checklisty, historia | wg roli |
| `/pracownicy/import` | kreator importu | admin, kadry |
| `/skaner` | skaner kodów QR | wg roli |
| `/szablony`, `/szablony/:id` | szablony dokumentów | admin |
| `/slowniki` | APT, wydziały, stanowiska, checklisty | admin, kadry |
| `/szkolenia`, `/braki` | szkolenia i braki | admin, kadry, kierownik |
| `/szkolenia/import` | import szkoleń | admin, kadry |
| `/zadania` | zadania do zrobienia | admin, kadry, kierownik |
| `/raporty` | raporty | admin, kadry, kierownik |
| `/zestawienia` | zestawienia osób dla agencji | admin, kadry, agencja |
| `/zgloszenia` | zgłoszenia nowych osób od agencji | admin, kadry, agencja |
| `/retencja` | trwałe usuwanie po terminie | admin |
| `/dziennik` | dziennik zdarzeń | admin |
| `/uzytkownicy`, `/wylaczeni` | konta | admin |
| `/podpis/:token` | publiczna strona podpisu (bez logowania) | osoba podpisująca |

## 1. Logowanie

```mermaid
flowchart TD
  A[Login + hasło] -->|błąd x5| L[Blokada 15 min]
  A -->|OK| B{Wymuszona zmiana hasła?}
  B -->|tak| C[Zmiana hasła] --> D
  B -->|nie| D{2FA włączone lub wymagane?}
  D -->|wymagane, brak| E[Konfiguracja TOTP + kody zapasowe] --> F
  D -->|włączone| F[Kod TOTP lub zapasowy]
  D -->|nie| G
  F --> G[Start]
```

## 2. Nowy pracownik

```mermaid
flowchart TD
  A[Kadry: Dodaj pracownika / Import / Zgłoszenie agencji] --> B[Walidacja PESEL, duplikaty]
  B -->|ten sam PESEL| X[Blokada]
  B -->|to samo imię+nazwisko+data ur.| Y[Potwierdzenie]
  B --> C[Numer ewidencyjny, przydział APT, checklista wdrożenia]
  C --> D[Zdjęcie] --> E[Karta PDF] --> F[Dokumenty i podpisy] --> G[Szkolenia i badania]
  G --> H[Checklista odhaczona automatycznie]
```

## 3. Dokument i podpis

```mermaid
flowchart TD
  A[Profil: Generuj dokument] --> B[Wybór szablonu, wypełnienie pól]
  B --> C[Word + PDF z miejscem na podpis]
  C --> D{Wymaga podpisu?}
  D -->|tak| E[Przejdź do podpisu]
  E --> F1[Link e-mail / SMS] --> G1[Strona /podpis/token: rysunek podpisu]
  E --> F2[Skan] --> G2[Wgranie podpisanego pliku]
  E --> F3[Podpis zaufany] --> G3[Wgranie PDF/XAdES]
  G1 --> H[PDF z podpisem + strona potwierdzenia]
  G2 --> H
  G3 --> H
  H --> I[Podgląd w aplikacji, pobranie, checklista Podpisany przez pracownika]
```

Skan jest zablokowany, gdy dokument ma podpis elektroniczny. Podpis można usunąć (trwale). Kierownik nie pobiera.

## 4. Agencja pracy

```mermaid
flowchart LR
  A[Konto agencji] --> B[Lista własnych osób]
  B --> C[Zdjęcie] 
  B --> D[Badanie lekarskie + skan]
  A --> E[Zgłoszenie nowej osoby] --> F{Kadry}
  F -->|zatwierdź| G[Powstaje pracownik]
  F -->|odrzuć + powód| H[Informacja dla agencji]
  I[1. dnia miesiąca] --> J[Excel zestawienia] --> K[E-mail do agencji + kopia do kadr]
```

## 5. Zmiana przydziału i zwolnienie

1. Zmiana APT / wydziału / stanowiska: od zaraz albo planowana na datę → wpis w `assignments`.
2. Zwolnienie: status `terminated`, data, checklista odejścia, osoba trafia do archiwum.
3. Ponowne zatrudnienie: stary okres do `employment_periods`, nowy przydział.
4. Po 10 latach (koniec roku): przypomnienie dla admina → trwałe usunięcie z potwierdzeniem „USUŃ”.

## 6. Dzienne zadanie (cron)

Uruchamiane po kopii zapasowej (`deploy/backup.sh` → `app.cli notify-daily`): planowane zmiany na dziś → w poniedziałki
przypomnienia o jakości danych i szkoleniach → 1. dnia miesiąca zestawienia dla agencji → e-mail do administratorów,
jeśli kopia się nie udała lub są dane do usunięcia.

## 7. Symulacja uprawnień

Administrator: menu konta → wybór roli (wydział kierownika albo APT agencji) → cały interfejs i API pokazują tylko to,
co widziałaby ta rola; baner z możliwością powrotu.
