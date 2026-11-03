# APT iD – zasady użycia logo

Znak aplikacji „Identyfikacja pracowników APT”. Litera **I** w nazwie to pracownik – głowa, barki i ręce wzdłuż ciała,
jedna zwarta sylwetka obok **D**. Człowiek w centrum: aplikacja służy agencji do prowadzenia jej pracowników
(karta, kartoteka, wdrożenie, szkolenia, dokumenty, komunikaty).

Przygotowane według procesu z [logo-design-skill](https://github.com/kaankiziltug/logo-design-skill): koncepcje,
testy (16 px, jeden kolor, odwrócenie, audyt SVG – 100/100), warianty i ikony z jego skryptów.

## 1. Wersje znaku

| Plik | Kiedy |
|---|---|
| `svg/apt-id-symbol.svg` | sam znak „iD” – ikona, awatar, małe miejsca |
| `svg/apt-id-horizontal.svg` | wersja pozioma „APT iD” – nagłówki, dokumenty, identyfikatory |
| `svg/apt-id-stacked.svg` | wersja pionowa (APT nad iD) – miejsca wąskie i wysokie |
| `svg/*-black.svg`, `*-white.svg` | jeden kolor: czarny na jasnym, biały na ciemnym tle |
| `svg/*-mono-d9bfa3.svg`, `*-mono-5c4636.svg` | jeden kolor marki (beż / orzech) |
| `svg/apt-id-symbol-app-icon.svg` | ikona aplikacji: beżowy znak na ciepłym ciemnym tle |
| `web/` | favicon (`favicon.ico`, `favicon.svg`), ikony 192/512, maskowalna 512, ikona iPhone 180 |

Litery są ścieżkami (bez czcionek) – pliki działają wszędzie bez instalowania fontów.

## 2. Pole ochronne

Wokół znaku zostaw wolne miejsce co najmniej **wysokości głowy postaci** (ok. 1/4 wysokości liter) z każdej strony.
Nie stawiaj w tym polu tekstu, ramek ani innych znaków.

## 3. Minimalny rozmiar

- znak „iD”: **24 px** na ekranie, **8 mm** w druku (przy 16 px – favicon – ręce postaci znikają, to w porządku);
- wersja pozioma „APT iD”: **96 px** szerokości na ekranie, **30 mm** w druku.

## 4. Kolory

| Kolor | HEX | RGB | Użycie |
|---|---|---|---|
| Beż (akcent, ciemny motyw) | `#D9BFA3` | 217 191 163 | znak na ciemnym tle, główne przyciski w ciemnym motywie |
| Orzech (akcent, jasny motyw) | `#5C4636` | 92 70 54 | znak na jasnym tle, główne przyciski w jasnym motywie |
| Ciepła czerń (tło) | `#1E1A17` | 30 26 23 | tło ikony aplikacji, ciemne powierzchnie |
| Ciepła biel (tło) | `#F5F4F2` | 245 244 242 | jasne powierzchnie |

Nigdy czysta biel ani czysta czerń jako tło marki. Wersje jednokolorowe zawsze w jednym z powyższych kolorów albo
w czerni/bieli (druk jednobarwny, grawer, haft).

## 5. Typografia

Litery znaku to własna geometria (jedna grubość kreski, nóżki A pod kątem 75°) – nie zastępuj ich czcionką.
W aplikacji teksty są w czcionce systemowej (`system-ui`, na iPhonie San Francisco).

## 6. Czego nie robić

- nie zmieniaj proporcji, nie obracaj, nie pochylaj;
- nie oddzielaj postaci od „D” ani nie zamieniaj jej na zwykłe „i” z kropką;
- nie dodawaj cieni, gradientów, obrysów;
- nie stawiaj znaku na zdjęciu bez jednolitego, kontrastowego tła;
- nie zmieniaj kolorów poza paletą z punktu 4.

## 7. Uwagi

- Sprawdzenie znaku towarowego (bazy UPRP/EUIPO, wyszukiwanie obrazem) przed szerszym użyciem – nie zostało wykonane.
- Tablica prezentacyjna z makietami: `prezentacja/` (`tablica.html` i slajdy PNG).
