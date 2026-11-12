#!/usr/bin/env node
/**
 * Sprawdza DODANE linie (git diff względem bazy, domyślnie origin/main) pod kątem fundamentów z CLAUDE.md:
 * rozmiary tekstu, odstępy, cudzysłowy, kolory na sztywno, opisy zaczynające się małą literą.
 * Użycie: node scripts/check-style.mjs [baza]   (np. HEAD~1). Kod wyjścia 1 = są uwagi.
 */
import { execSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";
const diff = execSync(`git diff -U0 ${base} -- 'src/*.css' 'src/*.tsx' 'src/*.ts' ../backend/app`, { encoding: "utf8", maxBuffer: 64e6 });

const FONT = new Set([26, 18, 15, 14, 13]); // tytuł, sekcja, wyróżnienie/treść, tabela, opis
const LINE = { 26: 32, 18: 24, 15: 22, 14: 20, 13: 18 };
const SPACE = new Set([0, 1, 2, 4, 8, 12, 16, 24, 32, 48]); // 1–2 px: obramowania, drobne przesunięcia
const ALLOWED_11 = /ui-case-ini|photo-placeholder|initials/; // inicjały w miejscu zdjęcia (jak w EmployeePhoto)
// wyjątek: pola tekstowe na telefonie – 16 px, inaczej iOS powiększa stronę przy wpisywaniu (klasa z „input”/„gname” w regule)
const ALLOWED_16 = /input|gname|textarea/i;

const issues = [];
let file = "";
let line = 0;
for (const raw of diff.split("\n")) {
  if (raw.startsWith("+++ ")) { file = raw.slice(6); continue; }
  const h = raw.match(/^@@ .*\+(\d+)/);
  if (h) { line = Number(h[1]); continue; }
  if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
  const s = raw.slice(1);
  const at = `${file}:${line}`;
  line++;
  if (/^\s*(\/\/|\*|\/\*|#)/.test(s)) continue; // komentarze

  for (const m of s.matchAll(/font-size:\s*(\d+)px(?:;\s*line-height:\s*(\d+)px)?/g)) {
    const fs = Number(m[1]);
    if (fs === 11 && ALLOWED_11.test(s)) continue;
    if (fs === 16 && ALLOWED_16.test(s)) continue;
    if (!FONT.has(fs)) issues.push(`${at}  rozmiar tekstu ${fs}px spoza skali (26/18/15/14/13)`);
    else if (m[2] && Number(m[2]) !== LINE[fs]) issues.push(`${at}  ${fs}px z wysokością linii ${m[2]}px – powinno być ${LINE[fs]}px`);
  }
  for (const m of s.matchAll(/\b(?:fz|fontSize)[=:]\s*\{?\s*(\d+)/g))
    if (!FONT.has(Number(m[1]))) issues.push(`${at}  fontSize ${m[1]} spoza skali`);
  for (const m of s.matchAll(/(?:^|[;{\s])(?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?:\s*([^;}]+)/g))
    for (const v of m[1].matchAll(/(-?\d+)px/g))
      if (!SPACE.has(Math.abs(Number(v[1])))) issues.push(`${at}  odstęp ${v[1]}px – używaj 4/8/12/16/24/32/48 (--s-1…--s-7)`);
  // polski: „…” (zamyka ten sam znak ” co angielski), angielski otwiera “ – tylko ten znak jest błędem
  if (/“/.test(s) || /(^|[\s(>{])”[A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż]/.test(s)) issues.push(`${at}  angielski cudzysłów “…” – w APT „…”`);
  if (/color:\s*#[0-9a-f]{3,6}/i.test(s) && file.endsWith(".css") && !/:root|--apt-/.test(s))
    issues.push(`${at}  kolor na sztywno – użyj zmiennej (--apt-*, --mantine-color-*), inaczej psuje motyw ciemny`);
  if (/(c|color)=["{]\s*["']?(yellow|orange|red)\.\d/.test(s))
    issues.push(`${at}  kolor ostrzeżenia na sztywno (np. yellow.8) – użyj klasy .ui-warn (ma jaśniejszy odcień w ciemnym motywie)`);
  for (const m of s.matchAll(/(?:what|title|label|description)\s*=\s*f?["`]([a-ząćęłńóśźż][^"`]{2,})/g))
    issues.push(`${at}  tekst dla użytkownika zaczyna się małą literą: „${m[1].slice(0, 30)}…”`);
}

if (issues.length) {
  console.log(`Uwagi (${issues.length}) w zmianach względem ${base}:\n` + issues.map((i) => "  • " + i).join("\n"));
  process.exit(1);
}
console.log(`Styl zgodny z fundamentami (zmiany względem ${base}).`);
