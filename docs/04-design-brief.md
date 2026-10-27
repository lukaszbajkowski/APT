# 4. Design brief

## Charakter

Narzędzie robocze dla działu kadr: spokojne, gęste informacyjnie, szybkie w obsłudze. Bez ozdobników;
priorytetem jest czytelność danych i pewność, że człowiek wie, co się stanie po kliknięciu.

## Fundamenty (Mantine)

| Element | Decyzja |
|---|---|
| Kolor główny | **Granat** `navy` (odcień 7 w jasnym, 5 w ciemnym motywie), ten sam co pasek na karcie identyfikacyjnej: `#3657a8` (7), `#1f3a73` (9) |
| Motyw | jasny, ciemny lub systemowy; wybór zapamiętuje przeglądarka |
| Krój | Inter, awaryjnie systemowy; na kartach PDF IBM Plex (SIL OFL) |
| Zaokrąglenia | `md` |
| Ikony | Tabler Icons |
| Język | polski, daty `dd.mm.rrrr`, numer ewidencyjny sześciocyfrowy (`000123`) |

Kolory semantyczne: zielony = OK / ważne, pomarańczowy = kończy się, czerwony = nieważne / usuwanie / błąd,
szary = brak danych.

## Układ

- Boczna nawigacja zależna od roli; prawy górny róg: menu konta (motyw, hasło, 2FA, symulacja ról dla administratora).
- Kliknięcie w nazwę aplikacji prowadzi na Start.
- Strona Start: liczniki → „Najbliższe 14 dni” → ostatnio dodani → szybkie akcje.
- Profil pracownika: nagłówek (zdjęcie, numer, status) + karty: dane, dokumenty, szkolenia, badania, checklisty, historia
  (5 ostatnich wpisów, reszta po kliknięciu).
- Listy: filtry nad tabelą, zaznaczanie wielu wierszy, akcje zbiorcze (karty, dokument, Excel).

## Wzorce interfejsu

- **Przyciski akcji:** zawsze przez wspólny komponent `ActionButton` (wariant `light`, rozmiar `sm`, ikona po lewej).
  Każdy nowy przycisk akcji na stronach (np. „Pokaż wszystkie”) używa go, żeby wyglądały tak samo.
- **Odstępy:** link „Pokaż wszystkie” ma `mt="md"` nad sobą.
- **Destrukcyjne akcje** (usuń dokument, podpis, badanie): czerwony, z potwierdzeniem; trwałe usunięcie danych wymaga wpisania „USUŃ”.
- **Komunikaty:** powiadomienia zielone po sukcesie; błędy czerwone w miejscu akcji, po polsku, z konkretną przyczyną.
- **Puste stany:** jedno zdanie + akcja, która to naprawia.
- **Długie treści** (nazwy urządzeń na stronie potwierdzenia podpisu, nazwiska dwuczłonowe na karcie): zawijanie lub druga linia, nigdy obcięcie ani wyjście poza ramkę.
- **Znaczniki stanu:** `Badge` w kolorze semantycznym (ważne do …, kończą się, nieważne).

## Karta identyfikacyjna

Wariant A: granatowy pasek „Identyfikator pracownika” (opcjonalnie data ważności), zdjęcie 3:4, nazwisko i imię,
APT, wydział, kod QR z numerem ewidencyjnym. Bez PESEL. Formaty: A4 po 10 sztuk (85,6 × 54 mm, znaczniki cięcia)
lub CR80 jedna na stronę.

## Dokumenty i podgląd

- Podgląd w aplikacji, nie w nowym oknie; strona po stronie, **komunikat „podgląd ukryty” zawsze na środku widoku**, niezależnie od przewijania.
- Znak wodny z imieniem użytkownika i czasem; kierownik bez pobierania.
- Podgląd podpisanego dokumentu pokazuje to samo, co pobranie: PDF z podpisem i stroną potwierdzenia.

## Dostępność i urządzenia

- Kontrast zgodny z domyślną paletą Mantine, obsługa klawiatury w formularzach i modalach.
- Strona podpisu `/podpis/:token` i skaner QR projektowane najpierw pod telefon (duże pola, jedna czynność na ekranie).
- Tabele na wąskich ekranach przewijane poziomo wewnątrz karty, nie cała strona.

## Szablony Word

Czcionka zgodna z dokumentem źródłowym, miejsce podpisu jako znacznik `ZZ…ZZ` w komórce tabeli, data podpisu jako dzisiejsza.
Przykład: `examples/szablony/medicover_deklaracja.docx`.

## Czego unikać

Kolorów spoza palety, nowych wariantów przycisków, modali w modalach, ukrywania kluczowych akcji w menu „…”
bez ikony, tekstu bez zawijania.
