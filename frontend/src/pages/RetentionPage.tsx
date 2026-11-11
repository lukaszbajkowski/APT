import { useRef, useState, type ReactNode } from "react";
import { rangeToggle } from "../components/SelectionBar";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconClockPause, IconTrash } from "@tabler/icons-react";

import { api, errorText, formatDate, type RetentionItem, type RetentionOverview } from "../api";
import { DateField } from "../components/DateField";
import { useMediaQuery } from "@mantine/hooks";
import { IconDots } from "@tabler/icons-react";
import { ActionSheet, CompactEmpty, ListRow, PageHead, Section as MSection, StatusBadge, FormDialog, PageTitle, PageLoading } from "../components/Mobile";

const CONFIRM = "USUŃ";

function PersonCell({ item }: { item: RetentionItem }) {
  return (
    <div>
      <Anchor component={Link} to={`/pracownicy/${item.id}`} size="sm" fw={500}>
        {item.name}
      </Anchor>
      <Text size="xs" c="dimmed">
        {item.number}
        {item.agency ? ` · ${item.agency}` : ""}
      </Text>
    </div>
  );
}

function Section({
  title,
  description,
  items,
  children,
}: {
  title: string;
  description: string;
  items: RetentionItem[];
  children: ReactNode;
}) {
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb={4}>
        <Title order={4}>{title}</Title>
        <Badge variant="light" color={items.length ? undefined : "gray"}>
          {items.length}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {description}
      </Text>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          Brak.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>{children}</Table.ScrollContainer>
      )}
    </Card>
  );
}

export function RetentionPage() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["retention"], queryFn: () => api<RetentionOverview>("/retention") });
  const [selected, setSelected] = useState<number[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [holdFor, setHoldFor] = useState<RetentionItem | null>(null);
  const [holdUntil, setHoldUntil] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [holdError, setHoldError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { kind: "all" | "due" | "held"; item?: RetentionItem }>(null);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const navigate = useNavigate();
  // ostatnio kliknięty wiersz (Shift + kliknięcie zaznacza zakres) – hook przed wczesnymi return
  const lastPicked = useRef<number | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["retention"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const purge = useMutation({
    mutationFn: () =>
      api<{ deleted: number }>("/retention/purge", {
        method: "POST",
        body: { employee_ids: selected, confirm: confirmText },
      }),
    onSuccess: (r) => {
      notifications.show({ color: "green", message: `Trwale usunięto dane ${r.deleted} os.` });
      setSelected([]);
      setConfirmOpen(false);
      setConfirmText("");
      refresh();
    },
  });

  const hold = useMutation({
    mutationFn: ({ item, clear }: { item: RetentionItem; clear?: boolean }) =>
      api(`/retention/${item.id}/hold`, {
        method: "POST",
        body: clear ? { until: null } : { until: holdUntil, reason: holdReason },
      }),
    onSuccess: (_, { clear }) => {
      notifications.show({ color: "green", message: clear ? "Zniesiono wstrzymanie." : "Wstrzymano usunięcie." });
      setHoldFor(null);
      setSelected([]);
      refresh();
    },
    onError: (e, { clear }) => {
      if (clear) notifications.show({ color: "red", message: errorText(e) });
      else setHoldError(errorText(e));
    },
  });

  if (data.isLoading) return <PageLoading title="Retencja danych" />;
  if (data.error || !data.data) return <Alert color="red">{errorText(data.error)}</Alert>;
  const d = data.data;
  const allDue = d.due.map((i) => i.id);
  /** kliknięcie pola na komputerze: z Shift zaznacza zakres od ostatnio klikniętego */
  const pickRow = (id: number, shift: boolean) => {
    setSelected((s) => [...rangeToggle(allDue, lastPicked.current, id, shift, new Set(s))]);
    lastPicked.current = id;
  };
  const openHold = (i: RetentionItem) => {
    setHoldFor(i);
    setHoldUntil("");
    setHoldReason("");
    setHoldError(null);
  };

  const modals = (
    <>
      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="Trwałe usunięcie danych" centered>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            purge.mutate();
          }}
        >
          <Stack>
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              Usuniesz trwale dane {selected.length} os.: dane osobowe, PESEL, zdjęcie i wygenerowane dokumenty. Tej
              operacji nie można cofnąć.
            </Alert>
            <TextInput
              label={`Aby potwierdzić, wpisz ${CONFIRM}`}
              value={confirmText}
              onChange={(e) => setConfirmText(e.currentTarget.value)}
              autoFocus
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmOpen(false)}>
                Anuluj
              </Button>
              <Button
                type="submit"
                color="red"
                loading={purge.isPending}
                disabled={confirmText.trim().toUpperCase() !== CONFIRM}
              >
                Usuń trwale
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <FormDialog opened={!!holdFor} onClose={() => setHoldFor(null)} title="Wstrzymanie usunięcia" primary={{ label: "Wstrzymaj", formId: "fd-hold", loading: hold.isPending }}>
        {holdFor && (
          <form id="fd-hold"
            onSubmit={(e) => {
              e.preventDefault();
              setHoldError(null);
              hold.mutate({ item: holdFor });
            }}
          >
            <Stack>
              <Text size="sm">
                {holdFor.name} ({holdFor.number}) – dane zostaną zachowane do podanej daty.
              </Text>
              {holdError && <Alert color="red">{holdError}</Alert>}
              <DateField label="Wstrzymaj do"  required value={holdUntil} onChange={(e) => setHoldUntil(e.currentTarget.value)} />
              <Textarea
                label="Powód"
                required
                autosize
                minRows={2}
                maxLength={500}
                placeholder="np. postępowanie przed sądem pracy, kontrola PIP"
                value={holdReason}
                onChange={(e) => setHoldReason(e.currentTarget.value)}
              />
            </Stack>
          </form>
        )}
      </FormDialog>
    </>
  );

  if (mobile) {
    const desc = (i: RetentionItem) => [i.number, i.agency, i.termination_date ? `zwolniony ${formatDate(i.termination_date)}` : null].filter(Boolean).join(" · ");
    return (
      <Stack gap={24}>
        <PageHead
          title="Retencja danych"
          subtitle={`Dane zwolnionych trzymamy ${d.years} lat od końca roku zwolnienia`}
          extra={d.due.length ? { label: "Więcej akcji", icon: <IconDots size={22} stroke={2.4} />, onClick: () => setSheet({ kind: "all" }) } : undefined}
        />
        <MSection title={`Do usunięcia · ${d.due.length}`}>
          {d.due.length === 0 ? (
            <CompactEmpty title="Nic do usunięcia" text="Nikomu nie minął jeszcze okres przechowywania." />
          ) : (
            d.due.map((i) => <ListRow key={i.id} title={i.name} description={desc(i)} trailing={<StatusBadge tone="warn">Termin minął</StatusBadge>} onClick={() => setSheet({ kind: "due", item: i })} />)
          )}
        </MSection>
        <MSection title={`Wkrótce · ${d.upcoming.length}`}>
          {d.upcoming.length === 0 ? (
            <CompactEmpty title="Brak" text="W ciągu 12 miesięcy nikomu nie kończy się okres przechowywania." />
          ) : (
            d.upcoming.map((i) => <ListRow key={i.id} title={i.name} description={desc(i)} trailing={<span className="ui-count-cell">do {formatDate(i.delete_after)}</span>} to={`/pracownicy/${i.id}`} />)
          )}
        </MSection>
        {d.held.length > 0 && (
          <MSection title={`Wstrzymane · ${d.held.length}`}>
            {d.held.map((i) => (
              <ListRow key={i.id} title={i.name} description={`do ${formatDate(i.hold_until)} · ${i.hold_reason ?? ""}`} trailing={<StatusBadge tone="wait">Wstrzymane</StatusBadge>} onClick={() => setSheet({ kind: "held", item: i })} />
            ))}
          </MSection>
        )}
        {d.missing_date.length > 0 && (
          <MSection title={`Bez daty zwolnienia · ${d.missing_date.length}`}>
            {d.missing_date.map((i) => <ListRow key={i.id} title={i.name} description="Uzupełnij datę zwolnienia w profilu" trailing={<StatusBadge tone="warn">Brak daty</StatusBadge>} to={`/pracownicy/${i.id}`} />)}
          </MSection>
        )}
        <ActionSheet
          opened={!!sheet}
          onClose={() => setSheet(null)}
          title={sheet?.kind === "all" ? "Do usunięcia" : sheet?.item?.name ?? ""}
          subtitle={sheet?.item ? desc(sheet.item) : undefined}
          actions={
            sheet?.kind === "all"
              ? [{ label: `Usuń trwale wszystkich (${d.due.length})`, description: "Dane osobowe, PESEL, zdjęcie i dokumenty", danger: true, onClick: () => { setSelected(allDue); setConfirmText(""); setConfirmOpen(true); } }]
              : sheet?.kind === "due" && sheet.item
                ? [
                    { label: "Otwórz kartę", onClick: () => navigate(`/pracownicy/${sheet.item!.id}`) },
                    { label: "Wstrzymaj usunięcie", description: "Np. postępowanie sądowe lub kontrola", icon: <IconClockPause size={20} />, onClick: () => openHold(sheet.item!) },
                    { label: "Usuń trwale", description: "Tej operacji nie można cofnąć", icon: <IconTrash size={20} />, danger: true, onClick: () => { setSelected([sheet.item!.id]); setConfirmText(""); setConfirmOpen(true); } },
                  ]
                : sheet?.kind === "held" && sheet.item
                  ? [
                      { label: "Otwórz kartę", onClick: () => navigate(`/pracownicy/${sheet.item!.id}`) },
                      { label: "Znieś wstrzymanie", description: "Dane wrócą na listę „Do usunięcia”", onClick: () => hold.mutate({ item: sheet.item!, clear: true }) },
                    ]
                  : []
          }
        />
        {modals}
      </Stack>
    );
  }

  return (
    <Stack maw={1100}>
      <PageTitle
        title="Retencja danych"
        description={
          <>
            Dane zwolnionych pracowników są przechowywane {d.years} lat, licząc od końca roku kalendarzowego, w którym
            nastąpiło zwolnienie (np. zwolnienie w 2026 → do 31.12.{2026 + d.years}). Po tym czasie usuń je trwale –
            razem ze zdjęciem i wygenerowanymi dokumentami. W dzienniku zdarzeń zostanie tylko numer ewidencyjny.
          </>
        }
      />

      <Section
        title="Do usunięcia"
        description="Okres przechowywania minął. Usunięcia nie da się cofnąć (dane znikną też z kopii zapasowych po 14 dniach)."
        items={d.due}
      >
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40}>
                <Checkbox
                  aria-label="Zaznacz wszystkich"
                  checked={selected.length > 0 && selected.length === allDue.length}
                  indeterminate={selected.length > 0 && selected.length < allDue.length}
                  onChange={() => setSelected(selected.length === allDue.length ? [] : allDue)}
                />
              </Table.Th>
              <Table.Th>Pracownik</Table.Th>
              <Table.Th>Zwolniony</Table.Th>
              <Table.Th>Przechowywać do</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.due.map((i) => (
              <Table.Tr key={i.id} className={selected.includes(i.id) ? "row-selected" : undefined}>
                <Table.Td>
                  <Checkbox aria-label={`Zaznacz ${i.name}`} checked={selected.includes(i.id)} onChange={() => undefined} onClick={(ev) => pickRow(i.id, ev.shiftKey)} />
                </Table.Td>
                <Table.Td>
                  <PersonCell item={i} />
                </Table.Td>
                <Table.Td>{formatDate(i.termination_date)}</Table.Td>
                <Table.Td>{formatDate(i.delete_after)}</Table.Td>
                <Table.Td align="right">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconClockPause size={14} />}
                    onClick={() => {
                      setHoldFor(i);
                      setHoldUntil("");
                      setHoldReason("");
                      setHoldError(null);
                    }}
                  >
                    Wstrzymaj
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="flex-end" mt="sm">
          <Button color="red" leftSection={<IconTrash size={16} />} disabled={!selected.length} onClick={() => setConfirmOpen(true)}>
            Usuń trwale zaznaczonych ({selected.length})
          </Button>
        </Group>
      </Section>

      <Section title="Wkrótce" description="Okres przechowywania kończy się w ciągu najbliższych 12 miesięcy." items={d.upcoming}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pracownik</Table.Th>
              <Table.Th>Zwolniony</Table.Th>
              <Table.Th>Przechowywać do</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.upcoming.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>
                  <PersonCell item={i} />
                </Table.Td>
                <Table.Td>{formatDate(i.termination_date)}</Table.Td>
                <Table.Td>{formatDate(i.delete_after)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>

      <Section
        title="Wstrzymane"
        description="Okres minął, ale usunięcie wstrzymano (np. postępowanie sądowe lub kontrola)."
        items={d.held}
      >
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pracownik</Table.Th>
              <Table.Th>Wstrzymane do</Table.Th>
              <Table.Th>Powód</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.held.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>
                  <PersonCell item={i} />
                </Table.Td>
                <Table.Td>{formatDate(i.hold_until)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{i.hold_reason}</Text>
                </Table.Td>
                <Table.Td align="right">
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => hold.mutate({ item: i, clear: true })}>
                    Znieś
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>

      {d.missing_date.length > 0 && (
        <Section
          title="Archiwum bez daty zwolnienia"
          description="Bez daty zwolnienia nie da się policzyć okresu przechowywania. Uzupełnij datę w profilu (przywróć i ponownie przenieś do archiwum)."
          items={d.missing_date}
        >
          <Table verticalSpacing="xs">
            <Table.Tbody>
              {d.missing_date.map((i) => (
                <Table.Tr key={i.id}>
                  <Table.Td>
                    <PersonCell item={i} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      )}

      {modals}
    </Stack>
  );
}
