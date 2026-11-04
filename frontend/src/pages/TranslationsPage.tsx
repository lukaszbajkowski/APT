import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Group, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconLanguage, IconSearch } from "@tabler/icons-react";

import { api, errorText, formatDateTime } from "../api";
import { CompactEmpty, FormDialog, ListRow, PageHead, Segments, StatusBadge } from "../components/Mobile";
import { Loading } from "../components/States";

type Origin = "manual" | "glossary" | "google";
interface Row {
  source: string;
  text: string;
  origin: Origin;
  updated_by_name: string | null;
  updated_at: string | null;
}
interface List {
  items: Row[];
  total: number;
  without_source: number;
}
interface Lang {
  code: string;
  count: number;
  manual: number;
}

// Google = jeszcze nikt nie sprawdził (zegar); słownik i poprawka = sprawdzone
const ORIGIN: Record<Origin, { tone: "ok" | "wait"; label: string }> = {
  manual: { tone: "ok", label: "Poprawione" },
  glossary: { tone: "ok", label: "Słownik" },
  google: { tone: "wait", label: "Google" },
};
const PAGE = 50;
// nazwy, gdy tłumacz jest wyłączony (bez listy języków z Google)
const KNOWN: Record<string, string> = { uk: "Ukraiński", ru: "Rosyjski", en: "Angielski", be: "Białoruski", ka: "Gruziński", hi: "Hindi", de: "Niemiecki", ro: "Rumuński", vi: "Wietnamski", tl: "Filipiński", ne: "Nepalski" };

/**
 * Tłumaczenia aplikacji (administrator): przegląd tego, co widzą pracownicy w innych językach, i ręczne poprawki.
 * Kolejność ważności: poprawka tutaj → słownik sprawdzonych słów (w kodzie) → tłumaczenie Google.
 */
export function TranslationsPage() {
  const langs = useQuery({ queryKey: ["i18n-admin-langs"], queryFn: () => api<Lang[]>("/i18n/admin/languages") });
  const names = useQuery({
    queryKey: ["i18n-languages", "pl"],
    queryFn: () => api<{ enabled: boolean; languages: { code: string; name: string }[] }>("/i18n/languages?lang=pl"),
    staleTime: 3600_000,
  });
  const [lang, setLang] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dq] = useDebouncedValue(q, 250);
  const [origin, setOrigin] = useState<"" | Origin>("");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Row | null>(null);

  useEffect(() => {
    if (!lang && langs.data?.length) setLang(langs.data[0].code);
  }, [lang, langs.data]);
  useEffect(() => setLimit(PAGE), [lang, dq, origin]);

  const list = useQuery({
    queryKey: ["i18n-admin", lang, dq, origin, limit],
    queryFn: () =>
      api<List>(`/i18n/admin/translations?lang=${encodeURIComponent(lang!)}&q=${encodeURIComponent(dq)}&origin=${origin}&limit=${limit}`),
    enabled: !!lang,
    placeholderData: (p) => p,
  });

  const nameOf = (code: string) => names.data?.languages.find((l) => l.code === code)?.name ?? KNOWN[code] ?? code.toUpperCase();
  if (langs.isLoading) return <Loading />;
  if (langs.error) return <Alert color="red">{errorText(langs.error)}</Alert>;

  return (
    <Stack gap={20} maw={820}>
      <PageHead
        title="Tłumaczenia"
        subtitle="Tak widzą aplikację pracownicy w innych językach. Popraw tłumaczenie, które brzmi źle – poprawka obowiązuje od razu u wszystkich."
      />
      {names.data && !names.data.enabled && (
        <Alert color="gray" variant="light">
          Tłumaczenie automatyczne jest wyłączone (brak klucza Google na serwerze). Działają tylko słownik i Twoje poprawki.
        </Alert>
      )}
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Język"
          data={(langs.data ?? []).map((l) => ({ value: l.code, label: `${nameOf(l.code)}${l.count ? ` · ${l.count}` : ""}` }))}
          value={lang}
          onChange={setLang}
          allowDeselect={false}
          w={240}
        />
        <TextInput
          label="Szukaj"
          placeholder="Polski tekst albo tłumaczenie…"
          leftSection={<IconSearch size={16} aria-hidden />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 220 }}
          autoComplete="off"
          spellCheck={false}
        />
      </Group>
      <Segments
        value={origin || "all"}
        onChange={(v) => setOrigin(v === "all" ? "" : (v as Origin))}
        items={[
          { value: "all", label: "Wszystkie" },
          { value: "google", label: "Google" },
          { value: "glossary", label: "Słownik" },
          { value: "manual", label: "Poprawione" },
        ]}
      />
      {list.isLoading && <Loading />}
      {list.error && <Alert color="red">{errorText(list.error)}</Alert>}
      {list.data && list.data.items.length === 0 && (
        <CompactEmpty
          title={dq ? `Brak wyników dla „${dq}”` : "Brak tłumaczeń w tym języku"}
          text={dq ? "Sprawdź pisownię albo wybierz inny filtr." : "Tłumaczenia pojawią się, gdy pracownik użyje aplikacji w tym języku."}
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <div className="ui-group">
          {list.data.items.map((r) => (
            <ListRow
              key={r.source}
              leading={
                <span className="ui-row-icon" aria-hidden>
                  <IconLanguage size={20} />
                </span>
              }
              title={<span translate="no">{r.text}</span>}
              description={r.source}
              onClick={() => setEditing(r)}
              trailing={<StatusBadge tone={ORIGIN[r.origin].tone}>{ORIGIN[r.origin].label}</StatusBadge>}
            />
          ))}
        </div>
      )}
      {list.data && list.data.total > list.data.items.length && (
        <Group justify="center">
          <Button variant="default" onClick={() => setLimit((l) => l + PAGE)} loading={list.isFetching}>
            Pokaż więcej ({list.data.total - list.data.items.length})
          </Button>
        </Group>
      )}
      {list.data && list.data.without_source > 0 && (
        <Text size="sm" c="dimmed">
          {list.data.without_source} starszych tłumaczeń nie ma jeszcze zapisanego polskiego oryginału – pojawią się tu same, gdy ktoś ich użyje.
        </Text>
      )}
      {editing && lang && <EditDialog lang={lang} langName={nameOf(lang)} row={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function EditDialog({ lang, langName, row, onClose }: { lang: string; langName: string; row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(row.text);
  const [error, setError] = useState<string | null>(null);
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["i18n-admin"] });
    qc.invalidateQueries({ queryKey: ["i18n-admin-langs"] });
    notifications.show({ color: "teal", message: msg });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => api("/i18n/admin/translations", { method: "PUT", body: { lang, source: row.source, text } }),
    onSuccess: () => done("Poprawka zapisana – pracownicy zobaczą ją po odświeżeniu aplikacji"),
    onError: (e) => setError(errorText(e)),
  });
  const reset = useMutation({
    mutationFn: () => api("/i18n/admin/translations/reset", { method: "POST", body: { lang, source: row.source } }),
    onSuccess: () => done(row.origin === "manual" ? "Przywrócono tłumaczenie automatyczne" : "Tłumaczenie zostanie pobrane od nowa"),
    onError: (e) => setError(errorText(e)),
  });
  const vars = row.source.match(/\{[A-Za-z_]\w*\}/g) ?? [];
  return (
    <FormDialog
      opened
      onClose={onClose}
      title={`Tłumaczenie · ${langName}`}
      dirty={text.trim() !== row.text}
      primary={{ label: "Zapisz poprawkę", onClick: () => save.mutate(), loading: save.isPending, disabled: !text.trim() || text.trim() === row.text }}
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}
        <div>
          <Text size="sm" c="dimmed">
            Po polsku
          </Text>
          <Text fw={600} style={{ overflowWrap: "anywhere" }}>
            {row.source}
          </Text>
        </div>
        <Textarea
          label={`Tłumaczenie (${langName})`}
          description={
            vars.length
              ? `Zostaw bez zmian pola w nawiasach: ${vars.join(", ")} – aplikacja wstawia w nie imię, nazwę dokumentu itp.`
              : "Krótko i tak, jak mówi się w tym języku na co dzień."
          }
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          autosize
          minRows={2}
          maxLength={2000}
          translate="no"
          lang={lang}
        />
        <Text size="sm" c="dimmed">
          {row.origin === "manual"
            ? `Poprawione${row.updated_by_name ? ` przez: ${row.updated_by_name}` : ""}${row.updated_at ? `, ${formatDateTime(row.updated_at)}` : ""}.`
            : row.origin === "glossary"
              ? "Ze słownika sprawdzonych słów aplikacji. Twoja poprawka będzie miała pierwszeństwo."
              : "Tłumaczenie automatyczne Google."}
        </Text>
        {(row.origin === "manual" || row.origin === "google") && (
          <Group>
            <Button variant="subtle" color="gray" loading={reset.isPending} onClick={() => reset.mutate()}>
              {row.origin === "manual" ? "Przywróć tłumaczenie automatyczne" : "Przetłumacz od nowa"}
            </Button>
          </Group>
        )}
      </Stack>
    </FormDialog>
  );
}
