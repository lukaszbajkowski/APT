# APT iD – wskazówki dla agenta

## Przegląd interfejsu (skill `web-design-guidelines`)

Zasady Vercela są pisane pod interfejs angielski. W APT obowiązują wyjątki – te reguły pomijaj albo stosuj w polskiej wersji:

- **Wielkie litery**: zdania, nie Title Case („Dodaj pracownika”, nie „Dodaj Pracownika”).
- **Cudzysłowy**: polskie „…” (otwierający dolny), nie “…”.
- **Teksty**: przez `t()` / `T()` – tłumaczenia są o 30–40% dłuższe, więc etykiet nie ucinamy, tylko zawijamy.
- **Daty i liczby**: helpery z `frontend/src/api.ts` (`formatDate`, `formatDateTime`) zamiast surowych `toLocaleString`.
- **Spójność ponad nowość**: najpierw gotowe bloki z `frontend/src/components/Mobile.tsx` i istniejące klasy `.ui-*`.

Pozostałe reguły (dostępność, fokus, formularze, animacje i `prefers-reduced-motion`, stany hover, motyw ciemny) stosuj w całości.

## Na później (zapisane na prośbę właściciela)

- **Lepszy silnik tłumaczeń** – model językowy z kontekstem („aplikacja kadrowa, to etykieta przycisku”) zamiast
  Google Translate dla stałych tekstów. Wymaga klucza API (właściciel wpisuje go sam w `.env`, nie prosić o niego)
  i dopisania dostawcy jako podmiotu przetwarzającego w informacji RODO. Dziś jakość poprawiają: słownik
  `backend/app/i18n_glossary.py` (uk, ru, en) i ekran administratora „Tłumaczenia” (`/tlumaczenia`).
- **Słownik dla kolejnych języków** (be, ka, hi…) – tylko z tłumaczeniem sprawdzonym przez osobę znającą język.
- Z listy „przed startem”: zbieranie błędów z przeglądarki i API, test obciążenia podglądu PDF (renderowanie
  stron idzie po kolei – `app/pdfium_safe.py`), pilot na jednej agencji.
