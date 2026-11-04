import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Menu, Select, Stack, Switch, TextInput, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDots, IconEdit, IconPlayerStop, IconPlus, IconTrash } from "@tabler/icons-react";

import { api, errorText } from "../api";
import { ActionSheet, CompactEmpty, FormDialog, ListRow, PageHead, Section, StatusBadge, type SheetAction } from "../components/Mobile";
import { isOngoing, NOTICE_KINDS, whenText, type NoticeKind, type ServiceNotice } from "../components/ServiceNotices";
import { Loading } from "../components/States";
import { allTimezones, HOME_TZ, isoToZonedInput, tzCity, tzLabel, zonedInputToIso } from "../lib/time";
import { useConfirm } from "../lib/confirm";

const KIND_OPTIONS = (Object.keys(NOTICE_KINDS) as NoticeKind[]).map((k) => ({ value: k, label: NOTICE_KINDS[k].label }));
const TITLE_HINT: Record<NoticeKind, string> = {
  planned: "np. Przerwa techniczna w sobotę wieczorem",
  deploy: "np. Nowa funkcja: podpisywanie dokumentów w telefonie",
  repair: "np. Naprawiamy wysyłkę powiadomień",
  incident: "np. Logowanie chwilowo nie działa",
  info: "np. Zmiana adresu pomocy technicznej",
};

/** ISO ↔ wartość pola datetime-local w wybranej strefie (domyślnie czas polski – w nim działa firma). */
const toLocal = (iso: string | null, tz: string) => isoToZonedInput(iso, tz);
const fromLocal = (v: string, tz: string) => zonedInputToIso(v, tz);

interface Draft {
  kind: NoticeKind;
  title: string;
  body: string;
  starts: string;
  ends: string;
  blocking: boolean;
  published: boolean;
  /** strefa, w której wpisano godziny */
  tz: string;
}
const EMPTY: Draft = { kind: "planned", title: "", body: "", starts: "", ends: "", blocking: false, published: true, tz: HOME_TZ };

type Stage = "now" | "planned" | "draft" | "over";
function stageOf(n: ServiceNotice, now: number): Stage {
  if (!n.published) return "draft";
  if (n.ends_at && new Date(n.ends_at).getTime() <= now) return "over";
  return isOngoing(n, now) ? "now" : "planned";
}
const STAGE_BADGE: Record<Stage, { tone: "ok" | "warn" | "error" | "neutral"; label: string }> = {
  now: { tone: "warn", label: "Trwa" },
  planned: { tone: "ok", label: "Zaplanowany" },
  draft: { tone: "neutral", label: "Szkic" },
  over: { tone: "neutral", label: "Zakończony" },
};

export function ServiceNoticesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const q = useQuery({ queryKey: ["service-notices"], queryFn: () => api<ServiceNotice[]>("/service-notices"), refetchInterval: 60_000 });
  const [editing, setEditing] = useState<ServiceNotice | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [sheet, setSheet] = useState<ServiceNotice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["service-notices"] });
    qc.invalidateQueries({ queryKey: ["service-notices-current"] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: draft.kind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        starts_at: fromLocal(draft.starts, draft.tz),
        ends_at: fromLocal(draft.ends, draft.tz),
        blocking: draft.blocking,
        published: draft.published,
      };
      return editing === "new"
        ? api<ServiceNotice>("/service-notices", { method: "POST", body })
        : api<ServiceNotice>(`/service-notices/${(editing as ServiceNotice).id}`, { method: "PUT", body });
    },
    onSuccess: () => {
      notifications.show({ color: "teal", message: editing === "new" ? "Komunikat dodany" : "Zmiany zapisane" });
      setEditing(null);
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const end = useMutation({
    mutationFn: (n: ServiceNotice) => api<ServiceNotice>(`/service-notices/${n.id}/end`, { method: "POST" }),
    onSuccess: () => {
      notifications.show({ color: "teal", message: "Komunikat zakończony – zniknął u wszystkich" });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (n: ServiceNotice) => api<void>(`/service-notices/${n.id}`, { method: "DELETE" }),
    onSuccess: () => {
      notifications.show({ color: "teal", message: "Komunikat usunięty" });
      refresh();
    },
  });

  const open = (n: ServiceNotice | "new") => {
    setError(null);
    setDraft(
      n === "new"
        ? EMPTY
        : {
            kind: n.kind,
            title: n.title,
            body: n.body,
            starts: toLocal(n.starts_at, HOME_TZ),
            ends: toLocal(n.ends_at, HOME_TZ),
            blocking: n.blocking,
            published: n.published,
            tz: HOME_TZ,
          },
    );
    setEditing(n);
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const now = Date.now();
  const all = q.data ?? [];
  const by = (s: Stage) => all.filter((n) => stageOf(n, now) === s);

  const actionsFor = (n: ServiceNotice): SheetAction[] => {
    const st = stageOf(n, now);
    const a: SheetAction[] = [{ label: "Edytuj", icon: <IconEdit size={20} />, onClick: () => open(n) }];
    if (st === "now" || st === "planned")
      a.push({
        label: st === "now" ? "Zakończ teraz" : "Odwołaj",
        description: "Komunikat od razu zniknie u wszystkich",
        icon: <IconPlayerStop size={20} />,
        warn: true,
        onClick: () => end.mutate(n),
      });
    a.push({
      label: "Usuń",
      icon: <IconTrash size={20} />,
      danger: true,
      onClick: () =>
        confirm({ title: "Usunąć komunikat?", message: `„${n.title}” zniknie także z historii komunikatów.`, confirmLabel: "Usuń", danger: true }).then(
          (ok) => ok && remove.mutate(n),
        ),
    });
    return a;
  };

  const row = (n: ServiceNotice) => {
    const k = NOTICE_KINDS[n.kind];
    const Icon = k.icon;
    const st = stageOf(n, now);
    const desc = [k.label, whenText(n, now).replace(/^Trwa · /, ""), n.blocking ? "blokuje aplikację" : ""].filter(Boolean).join(" · ");
    return (
      <ListRow
        key={n.id}
        leading={
          <span className="ui-row-icon" data-tone={st === "now" ? "warn" : undefined} aria-hidden>
            <Icon size={22} />
          </span>
        }
        title={n.title}
        description={desc}
        muted={st === "over"}
        onClick={mobile ? () => setSheet(n) : () => open(n)}
        trailing={
          <>
            <StatusBadge tone={STAGE_BADGE[st].tone}>{STAGE_BADGE[st].label}</StatusBadge>
            {!mobile && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" size={36} aria-label="Więcej" onClick={(e) => e.stopPropagation()}>
                    <IconDots size={20} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                  {actionsFor(n).map((a) => (
                    <Menu.Item key={a.label} leftSection={a.icon} color={a.danger ? "red" : a.warn ? "orange" : undefined} onClick={a.onClick}>
                      {a.label}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />
    );
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const invalid = !draft.title.trim() || (draft.blocking && !draft.ends) || (!!draft.starts && !!draft.ends && draft.ends <= draft.starts);

  return (
    <Stack gap={24} maw={760}>
      <PageHead
        title="Komunikaty techniczne"
        subtitle="Prace serwisowe, wdrożenia i awarie. Widzą je zalogowani użytkownicy – pasek na górze aplikacji."
        action={{ label: "Nowy komunikat", icon: <IconPlus size={22} />, onClick: () => open("new") }}
      />
      {all.length === 0 && (
        <CompactEmpty
          title="Brak komunikatów"
          text="Zapowiedz przerwę techniczną albo poinformuj o awarii – użytkownicy zobaczą pasek na górze aplikacji."
        />
      )}
      {by("now").length > 0 && <Section title="Trwają teraz">{by("now").map(row)}</Section>}
      {by("planned").length > 0 && <Section title="Zaplanowane">{by("planned").map(row)}</Section>}
      {by("draft").length > 0 && <Section title="Szkice (niewidoczne)">{by("draft").map(row)}</Section>}
      {by("over").length > 0 && <Section title="Zakończone">{by("over").slice(0, 20).map(row)}</Section>}

      <ActionSheet
        opened={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title ?? ""}
        subtitle={sheet ? whenText(sheet, now) : undefined}
        actions={sheet ? actionsFor(sheet).map((a) => ({ ...a, onClick: () => (setSheet(null), a.onClick()) })) : []}
      />

      <FormDialog
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Nowy komunikat techniczny" : "Edycja komunikatu"}
        primary={{
          label: editing === "new" ? (draft.published ? "Opublikuj" : "Zapisz szkic") : "Zapisz",
          onClick: () => save.mutate(),
          disabled: invalid,
          loading: save.isPending,
        }}
      >
        <Stack gap="md">
          {error && <Alert color="red">{error}</Alert>}
          <Select label="Rodzaj" data={KIND_OPTIONS} value={draft.kind} onChange={(v) => v && set("kind", v as NoticeKind)} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
          <TextInput label="Tytuł" placeholder={TITLE_HINT[draft.kind]} value={draft.title} onChange={(e) => set("title", e.currentTarget.value)} maxLength={120} required />
          <Textarea
            label="Wyjaśnienie dla użytkowników"
            description="Co się dzieje, czego nie da się zrobić i co zrobić w tym czasie."
            placeholder="np. Aktualizujemy system. W tym czasie nie da się logować ani podpisywać dokumentów."
            value={draft.body}
            onChange={(e) => set("body", e.currentTarget.value)}
            maxLength={1000}
            autosize
            minRows={3}
          />
          <Select
            label="Strefa czasowa godzin"
            description={draft.tz === HOME_TZ ? "Godziny wpisujesz w czasie polskim – tak zobaczą je wszyscy, z przeliczeniem na strefę odbiorcy." : `Godziny wpisujesz w strefie ${tzCity(draft.tz)}. Pracownicy zobaczą je w swojej strefie.`}
            data={allTimezones().map((z) => ({ value: z, label: tzLabel(z) }))}
            value={draft.tz}
            onChange={(v) => {
              if (!v) return;
              // ta sama chwila w nowej strefie (zmiana strefy nie przesuwa przerwy)
              setDraft((d) => ({
                ...d,
                tz: v,
                starts: d.starts ? toLocal(fromLocal(d.starts, d.tz), v) : "",
                ends: d.ends ? toLocal(fromLocal(d.ends, d.tz), v) : "",
              }));
            }}
            searchable
            // długa lista: na telefonie też z wpisywaniem (wyszukiwanie strefy)
            data-allow-typing
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <TextInput type="datetime-local" label={`Początek · ${tzLabel(draft.tz)}`} description="Puste – od razu" value={draft.starts} onChange={(e) => set("starts", e.currentTarget.value)} />
          <TextInput
            type="datetime-local"
            label={`Koniec · ${tzLabel(draft.tz)}`}
            description="Po tej godzinie komunikat sam zniknie"
            value={draft.ends}
            onChange={(e) => set("ends", e.currentTarget.value)}
            error={draft.starts && draft.ends && draft.ends <= draft.starts ? "Koniec musi być po początku" : draft.blocking && !draft.ends ? "Przerwa blokująca wymaga godziny zakończenia" : undefined}
          />
          <Switch
            label="Przerwa techniczna – blokuje aplikację"
            description="W tym czasie wszyscy poza administratorem zobaczą ekran „Przerwa techniczna” zamiast aplikacji."
            checked={draft.blocking}
            onChange={(e) => set("blocking", e.currentTarget.checked)}
          />
          <Switch
            label="Opublikuj"
            description="Wyłączone – szkic widoczny tylko tutaj."
            checked={draft.published}
            onChange={(e) => set("published", e.currentTarget.checked)}
          />
        </Stack>
      </FormDialog>
    </Stack>
  );
}
