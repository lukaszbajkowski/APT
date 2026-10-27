# 1. Wymagania produktowe (PRD)

## Cel produktu

Jedno miejsce, w którym dział kadr prowadzi kartotekę osób pracujących przez agencje pracy tymczasowej (APT),
drukuje identyfikatory, generuje i podpisuje dokumenty oraz pilnuje szkoleń i badań lekarskich.
Zastępuje arkusze Excela i ręczne dokumenty Word.

## Użytkownicy i role

| Rola | Kto | Co może |
|---|---|---|
| Administrator | właściciel systemu | wszystko: użytkownicy, szablony, słowniki, dziennik, retencja |
| Kadry | dział kadr | pełna kartoteka, karty, dokumenty, podpisy, szkolenia, badania, zgłoszenia agencji |
| Kierownik | przełożony | tylko osoby ze swoich wydziałów; PESEL i dane wrażliwe ukryte; bez pobierania dokumentów |
| Podgląd | audyt, ochrona | odczyt, PESEL zamaskowany |
| Agencja | pracownik APT | tylko własne osoby: lista, kartoteka (bez PESEL i uwag), zdjęcia, badania lekarskie, zgłaszanie nowych osób |

Administrator może symulować inne role (menu konta w prawym górnym rogu), żeby sprawdzić, co dana rola widzi.

## Zakres funkcjonalny

| # | Obszar | Wymagania |
|---|---|---|
| F1 | Konta i bezpieczeństwo | logowanie, 2FA (TOTP) obowiązkowe dla Administratora i Kadr, reset hasła e-mailem, blokada po 5 błędach, dziennik zdarzeń tylko do dopisywania |
| F2 | Kartoteka | numer ewidencyjny z sekwencji, PESEL szyfrowany i walidowany, wykrywanie duplikatów, zdjęcia 3:4, archiwum po zwolnieniu, historia zmian |
| F3 | Słowniki | APT (z adresem e-mail do zestawień), wydziały, stanowiska, kraje |
| F4 | Import | Excel / Numbers / CSV z kreatorem, podglądem błędów i zapisem w jednej transakcji |
| F5 | Karty identyfikacyjne | PDF A4 (10 kart) lub CR80, kod QR, druk seryjny, skaner QR w telefonie |
| F6 | Dokumenty | szablony .docx (Jinja), pola formularza, generowanie Word/PDF, paczki ZIP dla wielu osób, podgląd w aplikacji ze znakiem wodnym |
| F7 | Podpisy | elektroniczny na ekranie (link e-mail / SMS), skan, podpis zaufany (PDF/XAdES); strona potwierdzenia; usuwanie podpisu |
| F8 | Szkolenia | rodzaje, katalog stanowiskowy ze standardem czasu, opiekunowie, wymagania na stanowisku, raport braków, import |
| F9 | Cykl życia | historia przydziałów, ponowne zatrudnienie, planowane zmiany, checklisty wdrożenia i odejścia z automatycznym odhaczaniem |
| F10 | Badania lekarskie | rodzaj, data, ważność, skan orzeczenia; przypomnienia na stronie Start |
| F11 | Agencje pracy | miesięczne zestawienie osób (Excel, e-mail 1. dnia miesiąca), konto agencji, zgłoszenia nowych osób zatwierdzane przez kadry |
| F12 | Raporty | zestawienia wg APT, wydziału, obywatelstwa, stanowiska; eksport Excel |
| F13 | Retencja | przechowywanie 10 lat od końca roku zwolnienia, ręczne trwałe usunięcie, wstrzymanie |
| F14 | Operacje | kopie dzienne (14 dni) i zdalne (GPG, 30 dni), monitoring, e-maile systemowe |

## Wymagania niefunkcjonalne

- **Bezpieczeństwo danych osobowych (RODO):** PESEL szyfrowany AES-256-GCM, odczyt zapisywany w dzienniku, zasada najmniejszych uprawnień, retencja.
- **Dostępność:** jeden serwer VPS, odtworzenie z kopii; monitoring co 5 minut.
- **Użyteczność:** interfejs po polsku, motyw jasny/ciemny, działanie na telefonie (skaner, podpis).
- **Audytowalność:** każda wrażliwa operacja trafia do dziennika (kto, kiedy, IP).
- **Wydajność:** kilka tysięcy aktywnych osób, kilkunastu równoczesnych użytkowników.

## Poza zakresem (świadomie odrzucone)

Historia ważności kart, adres i telefon w kartotece, automatyczne sprawdzanie ukończenia szkolenia przez opiekuna.

## Kryteria sukcesu

- Brak arkuszy poza systemem do prowadzenia kartoteki.
- Każdy nowy pracownik ma zdjęcie, kartę, komplet podpisanych dokumentów i wymagane szkolenia bez ręcznego pilnowania.
- Agencje same uzupełniają zdjęcia i badania, a kadry tylko zatwierdzają.

## Otwarte pomysły

Kosz 30 dni dla usuniętych dokumentów, cotygodniowy e-mail o kończących się badaniach, wysyłka dokumentu e-mailem,
przegląd uprawnień, raport dostępu do PESEL, cykliczny test odtwarzania kopii, zapisane filtry, PWA.
