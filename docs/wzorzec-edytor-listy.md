# Wzorzec „edytor listy” (jak edycja szablonu)

Źródło prawdy: edycja szablonu (`components/TemplateEditDesktop.tsx`, `pages/TemplateEditPage.tsx`).
Ten sam układ mają dziś Słowniki (`components/DictionaryDesk.tsx`) i Checklisty (`components/Lifecycle.tsx`).

**Kiedy:** ekran, na którym użytkownik układa listę pozycji w grupach (przeciąganie, zmiana grupy) i edytuje
wybraną pozycję w panelu. **Zanim zaczniesz nowy taki ekran albo przerobisz istniejący – zapytaj właściciela:
„Robimy to jak edycję szablonu (wzorzec edytor listy)?”** Po „tak” stosuj poniższe wymiary bez odstępstw;
każde odstępstwo – najpierw pytanie.

## Elementy (używaj gotowych, nie pisz własnych)

| Element | Klasa / komponent |
|---|---|
| Lista z przeciąganiem i grupami | `TouchSortList` (`canvas`, `fixedGroups` gdy grup nie wolno przenosić) |
| Kartka z listą | `.ui-tpe-plist.ui-tpe-paper` |
| Nagłówek kartki (tylko komputer) | `.ui-tpe-paperhead` – tytuł `h2.ui-dsec-title` + podpowiedź `Text size="xs" c="dimmed"` |
| Panel wybranej pozycji (komputer) | `Paper.ui-tpe-panel` albo `.ui-cl-panel > .ui-cl-pbody` |
| Nagłówek panelu | `.ui-tpe-phead` – nazwa (`h2`) + podtytuł, po prawej ↑ ↓ (`ActionIcon`) |
| Zapis | pasek „Niezapisane zmiany: N · Odrzuć · Zapisz”, licznik z `countListChanges` |
| Telefon – edycja | arkusz od dołu: `Drawer` + `SheetHandle` + `useSheetResize`, start 60 %, „Gotowe”, domyślne przyciemnienie tła |

## Wymiary – komputer

- Układ: kartka + panel obok, `grid-template-columns: minmax(0,1fr) minmax(320px,420px)`, odstęp 32 (`--s-6`);
  wąsko (< 880 px obszaru) panel jako szuflada z prawej.
- Kartka: ramka 1 px `--apt-line`, promień lg, wnętrze 24 / 16 / 16 (`--s-5 --s-4 --s-4`), lekki cień.
- Nagłówek kartki: wnętrze 0 16 12, odstęp tytuł–podpowiedź 4.
- Grupa: tło `--apt-subtle`, ramka 1 px, promień md; odsunięta 8 od brzegu kartki; nagłówek 16 z lewej, 8 z prawej,
  nazwa 15/22 · 600 + licznik 13/18 szary; linia pod nagłówkiem. Nagłówek grupy 57 px (8 + nazwa + licznik + 8),
  16 px między grupami, pierwsza grupa bez odstępu nad sobą – tak samo na komputerze i telefonie.
- Wiersz w grupie: na całą szerokość grupy, każdy tej samej wysokości (bez dodatkowego odstępu w pierwszym i ostatnim),
  tekst 12 / 16 od brzegu (`.ui-tsl-cbody` 12 16), bez linii między wierszami; wybrany – obrys
  2 px kolorem głównym; podniesiony (przeciąganie) – tło powierzchni, cień.
- Panel: wnętrze 32 (`--s-6`), **odstęp między polami 16 (`--s-4`), także nagłówek → pierwsze pole 16**;
  przycisk usuwania na końcu, czerwony lekki.

## Wymiary – telefon

- Podpowiedź („Dotknij…, przytrzymaj…”) jako zwykły tekst `sm` szary **nad** kartką; kartka bez nagłówka.
- Margines ekranu 16 px – na telefonie cała aplikacja (`--app-shell-padding`).
- Kartka: wnętrze 12 / 0 / 8, promień md; grupy odsunięte 8 od brzegu (pozycja grupy x = kartka + 9).
- Grupa i wiersz jak na komputerze, wiersz z treścią nazwa + opis: wysokość 73, tekst 13 od brzegu grupy.
- Dotknięcie = edycja w arkuszu (60 %), przytrzymanie = przeciąganie; wybrany wiersz przewija się pod pasek.
- W poziomie, w czasie przeciągania: dolne menu chowa się, pasek zapisu zwija się do linii z licznikiem; etykieta
  „Trafi do” przy górnym pasku przechodzi pod wiersz (na dół pola).
- Arkusz: wnętrze 16 z boków, nagłówek (nazwa + podtytuł, ↑ ↓) i pierwsze pole na 95 px od góry arkusza, odstęp
  między polami 16 (ten sam `.ui-cl-pbody` co panel), „Gotowe” na całą szerokość na dole.

## Zachowanie

- Przeciągnięcie do innej grupy zmienia cechę pozycji (wydział, termin, aktywne / nieużywane) – zawsze z drugą drogą
  bez gestu w panelu (pole wyboru, przełącznik, ↑ ↓).
- Pozycja bez grupy (pole bez grupy, stanowisko bez wydziału) leży na kartce poza grupami, bez tła i ramki grupy –
  na komputerze 17 px od brzegu kartki, na telefonie 1 px; pole w panelu ma opis, co znaczy brak grupy.
- Zmiany lokalnie, zapis paskiem; „Odrzuć” wraca do zapisanego.
- Bez przewijania w przewijaniu – kartka ma pełną wysokość.

## Sprawdzenie

Zmierz nowy ekran tym samym skryptem co edycję szablonu (pozycja grupy, wysokość wiersza, odstęp tekstu,
odstępy w panelu) na komputerze 1440 i telefonie w pionie – liczby mają się zgadzać z tym plikiem.
