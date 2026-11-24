# Pilot na jednej agencji

Cel: przed uruchomieniem dla wszystkich sprawdzić APT iD na prawdziwych danych jednej agencji, w jednym
wydziale, przez 3 tygodnie. Pilot ma odpowiedzieć na trzy pytania:

1. Czy kadry i kierownik szybciej robią to, co dziś robią w arkuszach i na papierze (karty, dokumenty, braki)?
2. Czy pracownicy zakładają konto na telefonie i z niego korzystają (wiadomości, komunikaty, dokumenty do podpisu)?
3. Czy system jest stabilny: kopie, poczta, brak błędów w „Stan systemu → Błędy aplikacji”?

## Zakres

| | Pilot |
|---|---|
| Agencja | jedna (najlepiej ta, z którą jest najlepszy kontakt i najwięcej osób w jednym wydziale) |
| Pracownicy | 20–50 osób z jednego wydziału, w tym kilka osób bez polskiego obywatelstwa (tłumaczenia, dokumenty pobytowe) |
| Konta personelu | 1–2 osoby z kadr, 1 kierownik wydziału, 1 osoba z agencji (portal agencji) |
| Czas | 3 tygodnie + tydzień przygotowań |
| Poza zakresem | pozostałe agencje i wydziały – działają jak dotąd; nic nie jest wyłączane |

## Tydzień 0 – przygotowanie

**Serwer i bezpieczeństwo (administrator)**

- [ ] Aktualna wersja wdrożona (`aptid-aktualizuj`), na ekranie „Stan systemu” wszystko zielone.
- [ ] Kopia zapasowa na serwerze i poza serwerem: wykonana dziś; test odtwarzania z ostatnich 7 dni – OK.
- [ ] Monitoring działa (`/opt/apt/deploy/monitor.sh status`), dodatkowo zewnętrzny (np. UptimeRobot na `/api/health`).
- [ ] Wysyłka e-mail włączona i sprawdzona (e-mail testowy dochodzi, nie trafia do spamu).
- [ ] 2FA włączone dla wszystkich kont personelu.
- [ ] „Błędy aplikacji” w „Stan systemu” – lista pusta (stare wpisy oznaczone jako rozwiązane).

**Formalności (RODO) – do potwierdzenia z agencją, nie przez aplikację**

- [ ] Umowa powierzenia przetwarzania danych z agencją obejmuje APT iD.
- [ ] Informacja dla pracowników o przetwarzaniu danych (strona „Prywatność” w aplikacji jest aktualna).
- [ ] Ustalone, kto po stronie agencji ma dostęp i w jakim zakresie (rola „agencja” widzi tylko swoich ludzi).

**Dane**

- [ ] Słowniki: agencja, wydział, stanowiska – uzupełnione.
- [ ] Import pracowników z arkusza (Pracownicy → Import); błędy z podglądu importu poprawione przed zapisem.
- [ ] Zdjęcia do kart: kto robi i kiedy (braki widać w kolumnie „Wymaga uwagi”).
- [ ] Szablony dokumentów potrzebnych w pilocie wgrane i sprawdzone na jednym pracowniku (podgląd „Tak zobaczy to
      użytkownik przy »Nowy dokument«”).
- [ ] Wymagane szkolenia stanowisk i dokumenty pobytowe uzupełnione dla osób w pilocie.

**Konta**

- [ ] Konta personelu założone (kadry, kierownik z przypisanym wydziałem, agencja).
- [ ] Zaproszenia do kont pracowników wysłane (karta pracownika → „Konto pracownika”), albo link przekazany na miejscu.

## Szkolenie (30 minut, na miejscu)

Kadry i kierownik – na komputerze i telefonie:

1. Lista pracowników: filtry, „Wymaga uwagi”, zapisane widoki.
2. Karta pracownika: dane, zdjęcie, druk karty, „Nowy dokument”.
3. Wiadomości i komunikaty (z potwierdzeniem przeczytania i przypomnieniem).
4. Na telefonie: przesunięcie wiersza w lewo (szybkie akcje), przytrzymanie (menu), arkusze zamykane ruchem w dół.
5. Gdzie zgłaszać uwagi (niżej).

Pracownicy – 5 minut przy odbiorze karty: założenie konta na telefonie (klucz dostępu / odcisk palca),
dodanie aplikacji do ekranu głównego, gdzie są wiadomości i dokumenty do podpisu.

## Tydzień 1–3 – przebieg

| Tydzień | Co robimy | Na co patrzymy |
|---|---|---|
| 1 | karty dla wszystkich osób w pilocie, konta pracowników, pierwsze dokumenty | ile kart wydrukowanych, ile kont założonych, pytania na miejscu |
| 2 | codzienna praca: dokumenty, wiadomości, komunikat do całego wydziału | czy kadry wracają do arkusza; czas odpowiedzi na wiadomości |
| 3 | praca bez wsparcia na miejscu; podsumowanie z każdą rolą (15 min) | lista uwag, decyzja o dalszym wdrożeniu |

Codziennie (administrator, 5 minut): „Stan systemu” – kopie, dysk, poczta, **Błędy aplikacji**.
Każdy nowy błąd: sprawdzić, poprawić, oznaczyć jako rozwiązany.

## Mierniki (po 3 tygodniach)

| Miernik | Cel |
|---|---|
| Pracownicy pilotu z wydrukowaną kartą | ≥ 90% |
| Pracownicy z założonym kontem | ≥ 60% |
| Komunikat: przeczytało (bez przypomnienia / z przypomnieniem) | ≥ 50% / ≥ 80% |
| Dokumenty z szablonów zamiast ręcznie | wszystkie, dla których jest szablon |
| Braki danych w wydziale („Wymaga uwagi”) | mniej niż na starcie |
| Błędy aplikacji niewyjaśnione dłużej niż 2 dni | 0 |
| Przerwy w działaniu (monitoring) | 0 poza zapowiedzianymi pracami |

Liczby bierzemy z aplikacji (filtr wydziału i agencji pilotu):

- karty – Pracownicy → „Z brakami” → „Bez wydrukowanej karty” (reszta to osoby z kartą),
- konta – Konta pracowników: liczniki „Aktywne / Czekają” przy przełączniku i w nagłówku,
- komunikaty – „Przeczytało x z y” przy komunikacie, braki – „Wymaga uwagi” na liście, błędy i przerwy – Stan systemu.

## Zbieranie uwag

- Personel: wiadomość do administratora albo krótka lista na koniec każdego tygodnia – co przeszkadza, czego brakuje.
- Pracownicy: przez Wiadomości w aplikacji („Masz pytanie do kadr?”).
- Każda uwaga z datą i ekranem (na telefonie czy komputerze) – trafia do listy zmian po pilocie.

## Kiedy przerwać pilot

- Utrata danych albo kopia zapasowa nie działa przez 2 dni z rzędu.
- Ten sam błąd blokuje pracę (np. druk kart, dokumenty) dłużej niż 1 dzień roboczy.
- Agencja albo pracownicy zgłaszają problem z ochroną danych.

Wtedy: komunikat techniczny w aplikacji (przerwa techniczna), praca wraca do dotychczasowego trybu,
dane zostają w systemie, decyzja o wznowieniu po usunięciu przyczyny.

## Po pilocie

1. Podsumowanie mierników i uwag (1 strona).
2. Lista poprawek: obowiązkowe przed kolejnymi agencjami / później.
3. Decyzja: kolejne wydziały tej agencji, potem kolejne agencje – z tym samym planem przygotowania.
