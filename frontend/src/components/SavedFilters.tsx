import { useState } from "react";
import { ActionIcon, Button, Group, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconBookmark, IconBookmarkPlus, IconX } from "@tabler/icons-react";

import { useAuth } from "../auth";

export interface Saved {
  name: string;
  query: string;
  default?: boolean;
}

function read(key: string): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.name === "string" && typeof x?.query === "string") : [];
  } catch {
    return [];
  }
}

/** Zapisane widoki listy pracowników (w tej przeglądarce, osobno dla każdego konta). */
export function useSavedFilters() {
  const { me } = useAuth();
  const key = `apt-filters-${me?.user.id ?? 0}`;
  const [items, setItems] = useState<Saved[]>(() => read(key));
  function persist(next: Saved[]) {
    setItems(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* tryb prywatny – widoki zostaną tylko do końca tej sesji */
    }
  }
  return {
    items,
    save: (name: string, query: string) => persist([...items.filter((i) => i.name !== name), { name, query, default: items.find((i) => i.name === name)?.default }].slice(-20)),
    remove: (name: string) => persist(items.filter((i) => i.name !== name)),
    rename: (from: string, to: string) => persist(items.filter((i) => i.name !== to || i.name === from).map((i) => (i.name === from ? { ...i, name: to } : i))),
    setDefault: (name: string | null) => persist(items.map((i) => ({ ...i, default: i.name === name || undefined }))),
    defaultView: items.find((i) => i.default) ?? null,
  };
}

/** Czytelny opis filtrów widoku, np. „Suszarnia krwi · z brakami”. */
export function describeQuery(query: string, names: { agency?: (id: string) => string | undefined; department?: (id: string) => string | undefined; position?: (id: string) => string | undefined }): string {
  const p = new URLSearchParams(query);
  const parts: string[] = [];
  const st = p.get("status");
  parts.push(st === "terminated" ? "Archiwum" : st === "all" ? "Wszyscy" : "Aktywni");
  const a = p.get("agency"), d = p.get("department"), po = p.get("position");
  if (a) parts.push(names.agency?.(a) ?? "agencja");
  if (d) parts.push(names.department?.(d) ?? "wydział");
  if (po) parts.push(names.position?.(po) ?? "stanowisko");
  if (p.getAll("missing").length) parts.push("z brakami");
  if (p.get("q")) parts.push(`„${p.get("q")}”`);
  return parts.join(" · ");
}

/**
 * Zapisane filtry listy pracowników: pamiętane w tej przeglądarce, osobno dla każdego konta.
 * Filtr to po prostu zestaw parametrów adresu (szukaj, status, APT, wydział, stanowisko, braki, sortowanie).
 */
export function SavedFilters({ params, onApply }: { params: URLSearchParams; onApply: (p: URLSearchParams) => void }) {
  const { me } = useAuth();
  const key = `apt-filters-${me?.user.id ?? 0}`;
  const [items, setItems] = useState<Saved[]>(() => read(key));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const current = new URLSearchParams(params);
  current.delete("page");
  const query = current.toString();

  function persist(next: Saved[]) {
    setItems(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* tryb prywatny – filtry zostaną tylko do końca tej sesji */
    }
  }

  function save() {
    const n = name.trim();
    if (!n) return;
    persist([...items.filter((i) => i.name !== n), { name: n, query }].slice(-20));
    setOpen(false);
    setName("");
  }

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button variant="default" leftSection={<IconBookmark size={16} />}>
            Zapisane filtry{items.length ? ` (${items.length})` : ""}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {items.length === 0 && <Menu.Label>Brak zapisanych filtrów</Menu.Label>}
          {items.map((i) => (
            <Menu.Item
              key={i.name}
              onClick={() => onApply(new URLSearchParams(i.query))}
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="red"
                  aria-label={`Usuń filtr ${i.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    persist(items.filter((x) => x.name !== i.name));
                  }}
                >
                  <IconX size={12} />
                </ActionIcon>
              }
            >
              {i.name}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item leftSection={<IconBookmarkPlus size={14} />} onClick={() => setOpen(true)}>
            Zapisz bieżący filtr…
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={open} onClose={() => setOpen(false)} title="Zapisz filtr" size="sm">
        <Stack>
          <Text size="sm" c="dimmed">
            Zapamiętamy bieżące wyszukiwanie, status, APT, wydział, stanowisko, braki i sortowanie. Filtry są zapisywane w tej przeglądarce.
          </Text>
          <TextInput label="Nazwa" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={40} data-autofocus onKeyDown={(e) => e.key === "Enter" && save()} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Anuluj
            </Button>
            <Button disabled={!name.trim()} onClick={save}>
              Zapisz
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
