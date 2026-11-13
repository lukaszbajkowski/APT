# APT iD – wskazówki dla agenta

## Przegląd interfejsu (skill `web-design-guidelines`)

Zasady Vercela są pisane pod interfejs angielski. W APT obowiązują wyjątki – te reguły pomijaj albo stosuj w polskiej wersji:

- **Wielkie litery**: zdania, nie Title Case („Dodaj pracownika”, nie „Dodaj Pracownika”).
- **Cudzysłowy**: polskie „…” (otwierający dolny), nie “…”.
- **Teksty**: przez `t()` / `T()` – tłumaczenia są o 30–40% dłuższe, więc etykiet nie ucinamy, tylko zawijamy.
- **Daty i liczby**: helpery z `frontend/src/api.ts` (`formatDate`, `formatDateTime`) zamiast surowych `toLocaleString`.
- **Spójność ponad nowość**: najpierw gotowe bloki z `frontend/src/components/Mobile.tsx` i istniejące klasy `.ui-*`.

Pozostałe reguły (dostępność, fokus, formularze, animacje i `prefers-reduced-motion`, stany hover, motyw ciemny) stosuj w całości.

## Skill ui-ux-pro-max

Przy każdej zmianie wyglądu lub zachowania interfejsu korzystaj ze skilla `ui-ux-pro-max` (`.claude/skills/ui-ux-pro-max`) –
bez czekania na komendę `/ui-ux-pro-max`. Jego wyniki to rekomendacje: reguły z tego pliku (skala, kolory, polski) mają pierwszeństwo.

## Fundamenty wyglądu (etap 1 przeprojektowania na komputer)

- Krój **Golos Text** (`@fontsource/golos-text`, z naszego serwera); numery kart i PESEL – krój o stałej szerokości.
- Tekst: 6 stopni – tytuł 26/32, sekcja 18/24, wyróżnienie 15/22 · 600, treść 15/22, tabela 14/20, opis 13/18
  (Mantine: xl / lg / md / sm / xs; nagłówki h1–h2 tytuł, h3–h4 sekcja). Nie dodawaj nowych rozmiarów.
  Jedyny wyjątek: pola tekstowe na telefonie mogą mieć 16 px (iOS powiększa stronę przy wpisywaniu w mniejsze pole).
- Odstępy co 4 px: 4 · 8 · 12 · 16 · 24 · 32 · 48 (zmienne `--s-1`…`--s-7`).
- Szerokość: listy i tabele do 1760 px, tekst do czytania ≤ 72 znaki; margines strony 32 px, ≥ 1600 px – 48.
- Powierzchnie: sekcje na tle (nagłówek + odstęp), ramka tylko wokół listy / tabeli / „rzeczy”; bez kart w kartach.
- Kolory: orzech = główna akcja i wybór, bursztyn = wymaga działania, czerwień = błąd / usuwanie,
  szałwia = potwierdzenie po akcji; reszta szarym lub zwykłym tekstem. Paleta bez zmian.
- Akcje: jedna pełna akcja główna na widok, reszta obramowana / tekstowa, rzadkie i niebezpieczne w „⋯”.
- Nagłówek strony: zawsze `PageTitle` z `components/Mobile.tsx` (wzór: lista Pracownicy) – tytuł i licznik
  po lewej, akcje po prawej w tej samej linii, opis pod spodem (≤ 72 znaki szerokości). Bez własnych układów nagłówka.
  Licznik obok tytułu: każdy fragment po „·” od wielkiej litery („Wersja 0.1.0 · Migracja 0047”), ta sama treść co na telefonie.
- Żywa dokumentacja: ekran „Wzornik” (`/wzornik`).

## Sprawdzenie przed oddaniem (obowiązkowe przy każdej zmianie wyglądu lub zachowania)

Nie pisz „gotowe”, dopóki nie przejdziesz tej listy dla każdego zmienionego ekranu:

1. **Styl:** `cd frontend && node scripts/check-style.mjs origin/main` – rozmiary tekstu i odstępy ze skali,
   polskie cudzysłowy, kolory przez zmienne (bez `yellow.8` / `#…` na sztywno), teksty od wielkiej litery.
2. **Przegląd ekranu:** `APT_UI_PASSWORD=… node scripts/ui-check.mjs /ścieżka [/inna]` (tylko lokalne demo –
   klika przyciski i zmienia dane). Robi zrzuty dla każdej roli (admin, kierownik, agencja) × jasny/ciemny ×
   **każde urządzenie**: komputer 1440 i 800 px, telefon w pionie i w poziomie, tablet w pionie i w poziomie –
   w trakcie ładowania (opóźnione API) i po nim, klika przyciski i zgłasza błędy JS, odpowiedzi API ≥ 400
   i czerwone powiadomienia.
3. **Obejrzyj zrzuty** – skrypt nie oceni wyglądu: ciemny motyw (kontrast bursztynu), wąskie okno (nic nie
   ucięte, brak przewijania w bok), szkielet w kształcie treści i bez przeskoku po załadowaniu (treść w tym
   samym miejscu), jedna pełna akcja główna, brak kart w kartach.
   **Zawsze na wszystkim** (prośba właściciela): każdą zmianę wyglądu lub zachowania sprawdzaj od razu na
   wszystkich urządzeniach z punktu 2 – także gdy prośba wymienia tylko jedno urządzenie i także gdy wydaje się,
   że zmiana dotyczy tylko jednego układu (np. „to tylko komputer”) – nie zawężaj listy własnym przypuszczeniem,
   sprawdź i napisz wynik dla każdego urządzenia. Interakcje dotykowe
   (przytrzymanie, przeciąganie, arkusze od dołu) sprawdzaj na telefonie i tablecie.
   **Oba motywy tylko przy kolorach**: jasny i ciemny sprawdzaj, gdy zmiana dotyka tego, co zależy od motywu
   (kolory, tła, obramowania, cienie, kontrast, nowe elementy na ekranie). Zmiany niezależne od kolorystyki
   (ruch, kąty, odstępy, układ, logika) – jeden motyw (`--schemes light`), wszystkie urządzenia.
4. **Globalnie:** zmiana na komputerze dotyczy wszystkich ról personelu, nie tylko kadr – sprawdź, co widzi
   każda rola i czy nie widzi akcji, do której serwer jej nie dopuści.
5. **Testy:** `pytest` (backend), `npx tsc --noEmit` i `npx vite build` (frontend).

W odpowiedzi napisz, co sprawdzone, a czego nie (np. „telefon nieoglądany”).

## Na później (zapisane na prośbę właściciela)

- **Lepszy silnik tłumaczeń** – model językowy z kontekstem („aplikacja kadrowa, to etykieta przycisku”) zamiast
  Google Translate dla stałych tekstów. Wymaga klucza API (właściciel wpisuje go sam w `.env`, nie prosić o niego)
  i dopisania dostawcy jako podmiotu przetwarzającego w informacji RODO. Dziś jakość poprawiają: słownik
  `backend/app/i18n_glossary.py` (uk, ru, en) i ekran administratora „Tłumaczenia” (`/tlumaczenia`).
- **Słownik dla kolejnych języków** (be, ka, hi…) – tylko z tłumaczeniem sprawdzonym przez osobę znającą język.
- Z listy „przed startem”: zbieranie błędów z przeglądarki i API, test obciążenia podglądu PDF (renderowanie
  stron idzie po kolei – `app/pdfium_safe.py`), pilot na jednej agencji.
