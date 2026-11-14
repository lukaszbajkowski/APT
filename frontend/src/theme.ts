import { Combobox, createTheme, Drawer, SegmentedControl, Menu, Modal, Popover, type MantineColorsTuple } from "@mantine/core";

/*
 * Paleta „ciepłe neutralne” – jasny i ciemny motyw.
 * Każda paleta jest ułożona tak, by Mantine sam dobierał właściwe odcienie:
 *  - motyw jasny: odcień 7 = wypełnienie przycisku, tekst i ikony (kontrast ≥ 6:1 na karcie),
 *  - motyw ciemny: odcień 5 = wypełnienie (ciemny tekst, ≥ 8:1), 4 = tekst (≥ 7.8:1), 0 = tekst na jasnym tle plakietki.
 * Kontrasty policzone wg WCAG 2.1 – zestawienie w docs/06-implementation-plan.md („Kolory i kontrast”).
 * Nie używamy czystej bieli ani czerni; czerwony tylko dla błędów i usuwania,
 * bursztyn (orange/yellow) tylko dla braków i ostrzeżeń, szałwia (green/teal) dla stanu „w porządku”.
 */
const orzech: MantineColorsTuple = ["#F7F2ED", "#F0E5DA", "#EAD9C6", "#E6D2BB", "#E3CCB2", "#D9BFA3", "#B49B82", "#5C4636", "#4E3C2E", "#403126"];
const red: MantineColorsTuple = ["#FCEEEC", "#F9D7D3", "#F7C0BA", "#F5B2AB", "#F4A8A0", "#EE9A91", "#D87B72", "#A3322A", "#8B2A24", "#72231D"];
const amber: MantineColorsTuple = ["#FCEFE3", "#F9D7B7", "#F5BF8B", "#F4B172", "#F2A65E", "#F0A35B", "#D68843", "#9A4A0B", "#833F09", "#6C3408"];
const sage: MantineColorsTuple = ["#E8F0E6", "#D5E5D4", "#C2DAC2", "#B8D4B8", "#AFCFB0", "#9CC09E", "#80A182", "#3F5A41", "#364C37", "#2C3F2E"];
const slate: MantineColorsTuple = ["#EAF0F7", "#D7E2EF", "#C3D4E8", "#B8CBE3", "#AFC5E0", "#9DB6D6", "#7E99BA", "#35557A", "#2D4868", "#253C55"];
const grape: MantineColorsTuple = ["#F4EDF7", "#EADCF0", "#E0CCE9", "#DAC2E5", "#D6BBE2", "#CBAADA", "#AE8ABD", "#6A3F7A", "#5A3668", "#4A2C55"];

// neutralne (motyw jasny): 4 = obrys pól (3,6:1), 5 = podpowiedź w polu (4,6:1), 6 = tekst pomocniczy (7,4:1)
const gray: MantineColorsTuple = ["#F5F4F2", "#EFECE8", "#EAE7E4", "#E7E5E4", "#8C847D", "#78716C", "#57534E", "#44403C", "#292524", "#1C1917"];
// neutralne (motyw ciemny): 0 tekst, 2 tekst pomocniczy, 3 podpowiedź, 4 obrys pól, 6 karty i pola, 7 tło
const dark: MantineColorsTuple = ["#F0EAE3", "#C4BAB0", "#ABA197", "#978D84", "#807670", "#383230", "#272220", "#1E1A17", "#171412", "#110E0C"];

export const theme = createTheme({
  primaryColor: "orzech",
  primaryShade: { light: 7, dark: 5 },
  autoContrast: true,
  luminanceThreshold: 0.35,
  white: "#FCFBFA",
  black: "#1C1917",
  colors: {
    orzech,
    gray,
    dark,
    red,
    orange: amber,
    yellow: amber,
    green: sage,
    teal: sage,
    lime: sage,
    blue: slate,
    cyan: slate,
    indigo: slate,
    grape,
    violet: grape,
    pink: grape,
  },
  defaultRadius: "md",
  focusRing: "auto",
  cursorType: "pointer",
  // Fundamenty (etap 1): krój Golos Text, 6 stopni tekstu, odstępy co 4 px. Numery kart i PESEL zostają
  // w kroju o stałej szerokości (fontFamilyMonospace).
  fontFamily: "'Golos Text', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  // xs opis/etykieta 13 · sm tabela 14 · md treść 15 · lg sekcja 18 · xl tytuł 26
  fontSizes: { xs: "0.8125rem", sm: "0.875rem", md: "0.9375rem", lg: "1.125rem", xl: "1.625rem" },
  lineHeights: { xs: "1.385", sm: "1.43", md: "1.467", lg: "1.333", xl: "1.23" },
  spacing: { xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
  headings: {
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "1.625rem", lineHeight: "2rem" }, // tytuł strony
      h2: { fontSize: "1.625rem", lineHeight: "2rem" }, // tytuł strony (starsze ekrany używają h2)
      h3: { fontSize: "1.125rem", lineHeight: "1.5rem", fontWeight: "650" }, // sekcja
      h4: { fontSize: "1.125rem", lineHeight: "1.5rem", fontWeight: "650" }, // sekcja / tytuł listy
      h5: { fontSize: "0.9375rem", lineHeight: "1.375rem", fontWeight: "600" }, // wyróżnienie
      h6: { fontSize: "0.8125rem", lineHeight: "1.125rem", fontWeight: "600" },
    },
  },
  components: {
    // okna dialogowe na środku ekranu – w zasięgu kciuka na telefonie
    Modal: Modal.extend({ defaultProps: { centered: true } }),
    // szuflady i arkusze od dołu: krzywa arkuszy iOS – szybki start, długie, miękkie dojście; zamykanie krótsze
    Drawer: Drawer.extend({ defaultProps: { transitionProps: { duration: 420, exitDuration: 260, timingFunction: "cubic-bezier(.32,.72,0,1)" } } }),
    // warstwy rozwijane (menu „⋯”, listy wyboru, kalendarz) z cieniem – wychodzą na pierwszy plan
    Menu: Menu.extend({ defaultProps: { shadow: "md" } }),
    Popover: Popover.extend({ defaultProps: { shadow: "md" } }),
    Combobox: Combobox.extend({ defaultProps: { shadow: "md" } }),
    // przełączniki: wskaźnik przesuwa się płynnie z lekkim odbiciem (bez separatorów – w CSS)
    SegmentedControl: SegmentedControl.extend({ defaultProps: { transitionDuration: 320, transitionTimingFunction: "cubic-bezier(.34,1.56,.64,1)" } }),
  },
});
