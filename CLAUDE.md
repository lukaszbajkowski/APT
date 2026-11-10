# APT iD – wskazówki dla agenta

## Przegląd interfejsu (skill `web-design-guidelines`)

Zasady Vercela są pisane pod interfejs angielski. W APT obowiązują wyjątki – te reguły pomijaj albo stosuj w polskiej wersji:

- **Wielkie litery**: zdania, nie Title Case („Dodaj pracownika”, nie „Dodaj Pracownika”).
- **Cudzysłowy**: polskie „…” (otwierający dolny), nie “…”.
- **Teksty**: przez `t()` / `T()` – tłumaczenia są o 30–40% dłuższe, więc etykiet nie ucinamy, tylko zawijamy.
- **Daty i liczby**: helpery z `frontend/src/api.ts` (`formatDate`, `formatDateTime`) zamiast surowych `toLocaleString`.
- **Spójność ponad nowość**: najpierw gotowe bloki z `frontend/src/components/Mobile.tsx` i istniejące klasy `.ui-*`.

Pozostałe reguły (dostępność, fokus, formularze, animacje i `prefers-reduced-motion`, stany hover, motyw ciemny) stosuj w całości.

## Fundamenty wyglądu (etap 1 przeprojektowania na komputer)

- Krój **Golos Text** (`@fontsource/golos-text`, z naszego serwera); numery kart i PESEL – krój o stałej szerokości.
- Tekst: 6 stopni – tytuł 26/32, sekcja 18/24, wyróżnienie 15/22 · 600, treść 15/22, tabela 14/20, opis 13/18
  (Mantine: xl / lg / md / sm / xs; nagłówki h1–h2 tytuł, h3–h4 sekcja). Nie dodawaj nowych rozmiarów.
- Odstępy co 4 px: 4 · 8 · 12 · 16 · 24 · 32 · 48 (zmienne `--s-1`…`--s-7`).
- Szerokość: listy i tabele do 1760 px, tekst do czytania ≤ 72 znaki; margines strony 32 px, ≥ 1600 px – 48.
- Powierzchnie: sekcje na tle (nagłówek + odstęp), ramka tylko wokół listy / tabeli / „rzeczy”; bez kart w kartach.
- Kolory: orzech = główna akcja i wybór, bursztyn = wymaga działania, czerwień = błąd / usuwanie,
  szałwia = potwierdzenie po akcji; reszta szarym lub zwykłym tekstem. Paleta bez zmian.
- Akcje: jedna pełna akcja główna na widok, reszta obramowana / tekstowa, rzadkie i niebezpieczne w „⋯”.
- Nagłówek strony: zawsze `PageTitle` z `components/Mobile.tsx` (wzór: lista Pracownicy) – tytuł i licznik
  po lewej, akcje po prawej w tej samej linii, opis pod spodem (≤ 72 znaki szerokości). Bez własnych układów nagłówka.
- Żywa dokumentacja: ekran „Wzornik” (`/wzornik`).

## Na później (zapisane na prośbę właściciela)

- **Lepszy silnik tłumaczeń** – model językowy z kontekstem („aplikacja kadrowa, to etykieta przycisku”) zamiast
  Google Translate dla stałych tekstów. Wymaga klucza API (właściciel wpisuje go sam w `.env`, nie prosić o niego)
  i dopisania dostawcy jako podmiotu przetwarzającego w informacji RODO. Dziś jakość poprawiają: słownik
  `backend/app/i18n_glossary.py` (uk, ru, en) i ekran administratora „Tłumaczenia” (`/tlumaczenia`).
- **Słownik dla kolejnych języków** (be, ka, hi…) – tylko z tłumaczeniem sprawdzonym przez osobę znającą język.
- Z listy „przed startem”: zbieranie błędów z przeglądarki i API, test obciążenia podglądu PDF (renderowanie
  stron idzie po kolei – `app/pdfium_safe.py`), pilot na jednej agencji.
