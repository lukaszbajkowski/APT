# APT iD – wskazówki dla agenta

## Przegląd interfejsu (skill `web-design-guidelines`)

Zasady Vercela są pisane pod interfejs angielski. W APT obowiązują wyjątki – te reguły pomijaj albo stosuj w polskiej wersji:

- **Wielkie litery**: zdania, nie Title Case („Dodaj pracownika”, nie „Dodaj Pracownika”).
- **Cudzysłowy**: polskie „…” (otwierający dolny), nie “…”.
- **Teksty**: przez `t()` / `T()` – tłumaczenia są o 30–40% dłuższe, więc etykiet nie ucinamy, tylko zawijamy.
- **Daty i liczby**: helpery z `frontend/src/api.ts` (`formatDate`, `formatDateTime`) zamiast surowych `toLocaleString`.
- **Spójność ponad nowość**: najpierw gotowe bloki z `frontend/src/components/Mobile.tsx` i istniejące klasy `.ui-*`.

Pozostałe reguły (dostępność, fokus, formularze, animacje i `prefers-reduced-motion`, stany hover, motyw ciemny) stosuj w całości.
