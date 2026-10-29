// Język aplikacji pracownika. Teksty w kodzie są po polsku i służą za klucze: `t("Do podpisu")`.
// Gdy pracownik wybrał inny język, brakujące teksty są wysyłane partiami do serwera (który tłumaczy je
// przez Google i zapamiętuje dla wszystkich), a wynik trafia też do pamięci przeglądarki. Do czasu
// przyjścia tłumaczenia widać polski tekst.
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Select } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { useAuth } from "../auth";

const MAX_LEN = 600;
const RTL = new Set(["ar", "he", "iw", "fa", "ur", "yi", "ps", "sd", "ug", "ckb", "dv"]);
const KEY = "apt-lang";

let lang: string | null = null;
let isPublic = true;
let version = 0;
const map = new Map<string, string>();
const failed = new Set<string>();
const pending = new Set<string>();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* brak dostępu do pamięci przeglądarki – działamy bez niej */
  }
}

function notify() {
  version++;
  subs.forEach((f) => f());
}

function configure(next: string | null, pub: boolean) {
  isPublic = pub;
  if (next === lang) return;
  lang = next;
  map.clear();
  failed.clear();
  pending.clear();
  if (next) {
    try {
      const raw = read(`apt-i18n-${next}`);
      if (raw) Object.entries(JSON.parse(raw) as Record<string, string>).forEach(([k, v]) => map.set(k, v));
    } catch {
      /* uszkodzona pamięć – zostanie odbudowana */
    }
  }
}

async function flush() {
  timer = null;
  if (!lang || pending.size === 0) return;
  const l = lang;
  const batch = [...pending].slice(0, 100);
  batch.forEach((s) => pending.delete(s));
  try {
    const r = await api<{ translations: Record<string, string> }>(isPublic ? "/i18n/public" : "/i18n/strings", {
      method: "POST",
      body: { lang: l, strings: batch },
    });
    if (l !== lang) return;
    for (const s of batch) {
      const tr = r.translations[s];
      if (tr === undefined) failed.add(s);
      else map.set(s, tr);
    }
    write(`apt-i18n-${l}`, JSON.stringify(Object.fromEntries(map)));
    notify();
  } catch {
    batch.forEach((s) => failed.add(s));
  }
  if (pending.size > 0) schedule();
}

function schedule() {
  if (timer === null) timer = setTimeout(flush, 60);
}

export type Vars = Record<string, string | number | null | undefined>;

export function fmt(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")) : text;
}

export function translateText(text: string, vars?: Vars): string {
  if (lang && text.trim() && text.length <= MAX_LEN) {
    const tr = map.get(text);
    if (tr !== undefined) return fmt(tr, vars);
    if (!failed.has(text) && !pending.has(text)) {
      pending.add(text);
      schedule();
    }
  }
  return fmt(text, vars);
}

interface I18nState {
  lang: string | null;
  setPublicLang: (l: string | null) => void;
}
const Ctx = createContext<I18nState>({ lang: null, setPublicLang: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const [pubLang, setPub] = useState<string | null>(() => read(KEY));
  const target = me ? (me.user.role === "employee" ? (me.user.language ?? null) : null) : pubLang;
  const effective = loading ? null : target;
  configure(effective, !me);
  useEffect(() => {
    if (me?.user.role === "employee") write(KEY, me.user.language ?? null);
  }, [me]);
  useEffect(() => {
    document.documentElement.lang = effective ?? "pl";
    document.documentElement.dir = effective && RTL.has(effective.split("-")[0].toLowerCase()) ? "rtl" : "ltr";
  }, [effective]);
  const setPublicLang = useCallback((l: string | null) => {
    write(KEY, l);
    setPub(l);
  }, []);
  return <Ctx.Provider value={{ lang: effective, setPublicLang }}>{children}</Ctx.Provider>;
}

/** Funkcja tłumacząca; komponent odświeża się, gdy dojdą tłumaczenia. */
export function useT() {
  useContext(Ctx);
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
  return translateText;
}

export function useLang() {
  return useContext(Ctx).lang;
}

/** Wybór języka: konto pracownika zapisuje wybór na serwerze, strony bez logowania – w przeglądarce. */
export function LanguagePicker({ size = "sm" }: { size?: "xs" | "sm" }) {
  const { me, setMe } = useAuth();
  const { lang: current, setPublicLang } = useContext(Ctx);
  const t = useT();
  const cfg = useQuery({
    // nazwy języków w wybranym języku strony
    queryKey: ["i18n-languages", current ?? "pl"],
    queryFn: () =>
      api<{ enabled: boolean; languages: { code: string; name: string }[] }>(`/i18n/languages?lang=${encodeURIComponent(current ?? "pl")}`),
    staleTime: 3600_000,
    placeholderData: (prev) => prev,
  });
  if (!cfg.data?.enabled || cfg.data.languages.length === 0) return null;
  const COMMON = ["pl", "uk", "ru", "en", "be", "ka", "hi"];
  const all = new Map(cfg.data.languages.map((l) => [l.code, l.name]));
  if (!all.has("pl")) all.set("pl", "Polski");
  const data = [
    { group: t("Najczęstsze"), items: COMMON.filter((c) => all.has(c)).map((c) => ({ value: c, label: all.get(c) as string })) },
    {
      group: t("Pozostałe"),
      items: [...all.entries()].filter(([c]) => !COMMON.includes(c)).map(([c, n]) => ({ value: c, label: n })),
    },
  ].filter((g) => g.items.length > 0);
  async function choose(v: string | null) {
    const next = !v || v === "pl" ? null : v;
    if (me && me.user.role === "employee") {
      await api("/i18n/language", { method: "PUT", body: { language: next } });
      setMe({ ...me, user: { ...me.user, language: next } });
    } else setPublicLang(next);
  }
  return (
    <Select
      size={size}
      allowDeselect={false}
      data={data}
      value={current ?? "pl"}
      onChange={(v) => void choose(v)}
      aria-label={t("Język")}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
