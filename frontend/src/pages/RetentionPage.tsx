import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
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
import { Loading } from "../components/States";

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
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
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

  if (data.isLoading) return <Loading />;
  if (data.error || !data.data) return <Alert color="red">{errorText(data.error)}</Alert>;
  const d = data.data;
  const allDue = d.due.map((i) => i.id);
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Stack maw={1100}>
      <div>
        <Title order={2}>Retencja danych</Title>
        <Text c="dimmed" size="sm">
          Dane zwolnionych pracowników są przechowywane {d.years} lat, licząc od końca roku kalendarzowego, w którym
          nastąpiło zwolnienie (np. zwolnienie w 2026 → do 31.12.{2026 + d.years}). Po tym czasie usuń je trwale –
          razem ze zdjęciem i wygenerowanymi dokumentami. W dzienniku zdarzeń zostanie tylko numer ewidencyjny.
        </Text>
      </div>

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
                  <Checkbox aria-label={`Zaznacz ${i.name}`} checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
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

      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="Trwałe usunięcie danych">
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

      <Modal opened={!!holdFor} onClose={() => setHoldFor(null)} title="Wstrzymanie usunięcia">
        {holdFor && (
          <form
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
              <TextInput label="Wstrzymaj do" type="date" required value={holdUntil} onChange={(e) => setHoldUntil(e.currentTarget.value)} />
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
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setHoldFor(null)}>
                  Anuluj
                </Button>
                <Button type="submit" loading={hold.isPending}>
                  Wstrzymaj
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
    </Stack>
  );
}
