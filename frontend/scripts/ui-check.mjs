#!/usr/bin/env node
/**
 * Przegląd ekranu przed oddaniem zmiany (lista z CLAUDE.md, „Sprawdzenie przed oddaniem”).
 * Dla każdej roli × motyw (jasny, ciemny) × urządzenie (komputer 1440 i 800, telefon w pionie i w poziomie,
 * tablet w pionie i w poziomie – zawsze wszystkie, chyba że --devices zawęzi listę):
 *   – zrzut w trakcie ładowania (odpowiedzi API celowo opóźnione) i po załadowaniu,
 *   – błędy JS, błędy w konsoli i odpowiedzi API ≥ 400.
 * Potem (rola po roli, jasny, 1440) klika po kolei przyciski na ekranie i zapisuje, co się zepsuło
 * (błąd JS, odpowiedź ≥ 400, czerwone powiadomienie). Pomija przyciski usuwające / wylogowujące.
 *
 * Tylko na lokalnym środowisku demo – kliknięcia zmieniają dane.
 *   APT_UI_PASSWORD=… node scripts/ui-check.mjs /pracownicy [/inna-strona] [--out katalog] [--users admin,kierownik] [--devices pc,telefon] [--schemes light]
 * --schemes light: zmiana niezależna od kolorystyki (ruch, układ, logika) – tylko jasny motyw.
 * Zmienne: APT_UI_BASE (domyślnie http://localhost:5173), APT_UI_USERS (admin,kierownik,agencja).
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const pages = args.filter((a, i) => a.startsWith("/") && !["--out", "--users", "--devices", "--schemes"].includes(args[i - 1]));
const schemes = opt("--schemes", "light,dark").split(",");
// urządzenia: komputer (szeroki i wąski), telefon (też duży w poziomie) i tablet w obu orientacjach (dotyk, prawdziwe proporcje ekranu)
const DEVICES = [
  { name: "pc-1440", ctx: { viewport: { width: 1440, height: 900 } } },
  { name: "pc-800", ctx: { viewport: { width: 800, height: 900 } } },
  { name: "telefon", ctx: devices["iPhone 13"] },
  { name: "telefon-poziom", ctx: devices["iPhone 13 landscape"] },
  // duży telefon w poziomie jest szerszy niż 900 px – dalej ma dostać interfejs telefonu (lib/device.ts)
  { name: "telefon-duzy-poziom", ctx: devices["iPhone 15 Pro Max landscape"] },
  { name: "tablet", ctx: devices["iPad Mini"] },
  { name: "tablet-poziom", ctx: devices["iPad Pro 11 landscape"] },
];
const only = opt("--devices", "");
const devs = only ? DEVICES.filter((d) => only.split(",").some((o) => d.name.startsWith(o))) : DEVICES;
const out = opt("--out", "ui-check-out");
const base = process.env.APT_UI_BASE ?? "http://localhost:5173";
const users = opt("--users", process.env.APT_UI_USERS ?? "admin,kierownik,agencja").split(",");
const password = process.env.APT_UI_PASSWORD;
if (!pages.length || !password) {
  console.error("Użycie: APT_UI_PASSWORD=… node scripts/ui-check.mjs /strona [/strona2] [--out katalog] [--users a,b]");
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) {
  console.error("Odmowa: przegląd klika przyciski i zmienia dane – uruchamiaj tylko na lokalnym demo.");
  process.exit(2);
}
try {
  await fetch(base);
} catch {
  console.error(`Serwer ${base} nie odpowiada – uruchom środowisko demo (backend i vite).`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const DANGER = /usuń|wyloguj|archiw|zwolnij|wyłącz|włącz|przerw|unieważ|odrzuć|trwale|resetuj|anuluj|zmień hasło|kosz|wyślij|opublikuj|importuj|zapisz|wgraj|zatwierdź|przypomnij|kopi[ęa]/i;
const report = [];
let clicks = 0;
const note = (where, what) => report.push(`${where}: ${what}`);
const slug = (p) => p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "dzis";

/** Nasłuch błędów dla jednej strony; zwraca funkcję, która go wyłącza (żeby błędy nie trafiały pod następną stronę). */
function watch(page, where) {
  const onErr = (e) => note(where, `błąd JS: ${e.message}`);
  const onCon = (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && note(where, `konsola: ${m.text().slice(0, 160)}`);
  const onRes = (r) => r.url().includes("/api/") && r.status() >= 400 && note(where, `API ${r.status()} ${r.request().method()} ${r.url().replace(base, "")}`);
  page.on("pageerror", onErr);
  page.on("console", onCon);
  page.on("response", onRes);
  return () => {
    page.off("pageerror", onErr);
    page.off("console", onCon);
    page.off("response", onRes);
  };
}

// jedno logowanie na rolę (serwer ogranicza liczbę prób), potem ta sama sesja w każdym kontekście
const sessions = {};
async function login(ctx, user) {
  if (sessions[user]) {
    await ctx.addCookies(sessions[user]);
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    if (!page.url().includes("/login")) return page;
    await page.close();
  }
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel("Login").fill(user);
  await page.getByLabel("Hasło").fill(password);
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10000 });
  sessions[user] = await ctx.cookies();
  return page;
}

const browser = await chromium.launch();
for (const user of users) {
  for (const scheme of schemes) {
    for (const dev of devs) {
      const width = dev.name;
      const ctx = await browser.newContext({ ...dev.ctx, colorScheme: scheme, reducedMotion: "reduce" });
      let page;
      try {
        page = await login(ctx, user);
      } catch {
        note(user, "nie udało się zalogować (konto istnieje w demo?)");
        await ctx.close();
        continue;
      }
      for (const path of pages) {
        const where = `${user} · ${scheme} · ${width} · ${path}`;
        const stop = watch(page, where);
        // najpierw inny ekran (aplikacja już uruchomiona), potem przejście w aplikacji – jak u użytkownika;
        // dopiero wtedy opóźniamy dane (inaczej widać tylko start aplikacji)
        await page.unroute("**/api/**");
        await page.goto(base + (path === "/" ? "/pomoc" : "/"));
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.route("**/api/**", async (r) => {
          await new Promise((x) => setTimeout(x, 2500));
          r.continue().catch(() => {});
        });
        await page.evaluate((p) => {
          window.history.pushState({}, "", p);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, path);
        await page.waitForTimeout(900);
        const name = `${out}/${slug(path)}-${user}-${scheme}-${width}`;
        await page.screenshot({ path: `${name}-ladowanie.png`, fullPage: true });
        if (await page.locator(".mantine-Loader-root").count()) note(where, "w trakcie ładowania kręci się wskaźnik zamiast szkieletu");
        await page.unroute("**/api/**");
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${name}.png`, fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 2) note(where, `strona przewija się w bok o ${overflow}px`);
        stop();
      }
      await ctx.close();
    }
  }

  // klikanie: jasny motyw, 1440
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page;
  try {
    page = await login(ctx, user);
  } catch {
    await ctx.close();
    continue;
  }
  for (const path of pages) {
    await page.goto(base + path);
    await page.waitForLoadState("networkidle").catch(() => {});
    // klikamy po kolei elementy według pozycji na stronie (nazwy wierszy i zakładek bywają długie albo złożone)
    const SEL = "main button:visible, main [role=button]:visible, main [role=tab]:visible, main a.mantine-Button-root:visible";
    const labels = await page.locator(SEL).evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ")));
    const seen = new Set();
    for (let i = 0; i < Math.min(labels.length, 40); i++) {
      const label = labels[i] || `element ${i + 1}`;
      if (DANGER.test(label) || seen.has(label)) continue;
      seen.add(label);
      const where = `${user} · klik „${label.slice(0, 40)}” · ${path}`;
      const before = report.length;
      const onErr = (e) => note(where, `błąd JS: ${e.message}`);
      const onRes = (r) => r.url().includes("/api/") && r.status() >= 400 && note(where, `API ${r.status()} ${r.request().method()} ${r.url().replace(base, "")}`);
      page.on("pageerror", onErr);
      page.on("response", onRes);
      try {
        await page.goto(base + path);
        await page.waitForLoadState("networkidle").catch(() => {});
        const target = page.locator(SEL).nth(i);
        if (await target.isDisabled().catch(() => false)) throw new Error("przycisk nieaktywny – pomijam");
        await target.click({ timeout: 3000 });
        clicks++;
        await page.waitForTimeout(900);
        const red = await page.locator(".mantine-Notification-root[data-color='red'], .mantine-Notification-root[style*='red']").allTextContents();
        for (const t of red) note(where, `czerwone powiadomienie: ${t.slice(0, 120)}`);
        await page.keyboard.press("Escape");
      } catch (e) {
        if (!/nieaktywny/.test(e.message)) note(where, `nie da się kliknąć (${String(e.message).split("\n")[0].slice(0, 80)})`);
      }
      page.off("pageerror", onErr);
      page.off("response", onRes);
      if (report.length > before) await page.screenshot({ path: `${out}/${slug(path)}-${user}-klik-${seen.size}.png` });
    }
  }
  await ctx.close();
}
await browser.close();

const text = report.length ? `Uwagi (${report.length}):\n` + [...new Set(report)].map((r) => "  • " + r).join("\n") : "Bez uwag.";
writeFileSync(`${out}/raport.txt`, text + "\n");
console.log(text + `\nKliknięte przyciski: ${clicks}. Zrzuty: ${out}/`);
process.exit(report.length ? 1 : 0);
