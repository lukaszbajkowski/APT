import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, Card, Grid, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFileSpreadsheet, IconFileTypePdf } from "@tabler/icons-react";

import { api, apiDownload, errorText, formatDateTime, type ReportRow, type ReportSummary } from "../api";

function Bar({ value, max, color = "var(--mantine-primary-color-filled)" }: { value: number; max: number; color?: string }) {
  const pct = max ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <Box h={8} style={{ background: "var(--mantine-color-default-border)", borderRadius: 4, overflow: "hidden" }}>
      <Box h="100%" w={`${value ? pct : 0}%`} style={{ background: color, borderRadius: 4 }} />
    </Box>
  );
}

function CountTable({ title, rows, limit = 12 }: { title: string; rows: ReportRow[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(0, ...rows.map((r) => r.count));
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <Card withBorder padding="lg" h="100%">
      <Title order={5} mb="sm">
        {title}
      </Title>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          Brak danych.
        </Text>
      ) : (
        <Table verticalSpacing={6} withRowBorders={false}>
          <Table.Tbody>
            {shown.map((r) => (
              <Table.Tr key={r.name}>
                <Table.Td w="40%">
                  <Text size="sm" c={r.name === "(brak)" ? "dimmed" : undefined}>
                    {r.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Bar value={r.count} max={max} />
                </Table.Td>
                <Table.Td w={90} ta="right">
                  <Text size="sm" fw={600} span>
                    {r.count}
                  </Text>{" "}
                  <Text size="xs" c="dimmed" span>
                    {total ? Math.round((r.count / total) * 100) : 0}%
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {rows.length > limit && (
        <Button variant="subtle" size="xs" mt="xs" onClick={() => setAll((a) => !a)}>
          {all ? "Pokaż mniej" : `Pokaż wszystkie (${rows.length})`}
        </Button>
      )}
    </Card>
  );
}

export function ReportsPage() {
  const data = useQuery({ queryKey: ["report-summary"], queryFn: () => api<ReportSummary>("/reports/summary") });
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);

  async function download(format: "xlsx" | "pdf") {
    setBusy(format);
    try {
      await apiDownload(`/reports/summary.xlsx${format === "pdf" ? "?format=pdf" : ""}`, undefined, `zestawienie.${format}`);
    } catch (e) {
      notifications.show({ color: "red", message: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  if (data.isLoading) return <Loader />;
  if (!data.data) return <Alert color="red">{errorText(data.error)}</Alert>;
  const s = data.data;
  const maxMonth = Math.max(1, ...s.months.flatMap((m) => [m.hired, m.terminated]));

  return (
    <Stack maw={1200}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Raporty</Title>
          <Text c="dimmed" size="sm">
            Zestawienie aktywnych pracowników · stan na {formatDateTime(s.generated_at)}
          </Text>
        </div>
        <Group gap="xs">
          <Button leftSection={<IconFileSpreadsheet size={16} />} onClick={() => download("xlsx")} loading={busy === "xlsx"}>
            Excel
          </Button>
          <Button variant="default" leftSection={<IconFileTypePdf size={16} />} onClick={() => download("pdf")} loading={busy === "pdf"}>
            PDF
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: s.missing_pesel === null ? 3 : 4 }}>
        {[
          { label: "Aktywni", value: s.active, to: "/pracownicy" },
          { label: "W archiwum", value: s.terminated, to: "/pracownicy?status=terminated" },
          { label: "Bez zdjęcia", value: s.missing_photo, to: "/pracownicy?missing=photo" },
          ...(s.missing_pesel === null ? [] : [{ label: "Bez PESEL", value: s.missing_pesel, to: "/pracownicy?missing=pesel" }]),
        ].map((x) => (
          <Card key={x.label} withBorder padding="md" component={Link} to={x.to}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {x.label}
            </Text>
            <Text fz={28} fw={700}>
              {x.value.toLocaleString("pl-PL")}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CountTable title="APT" rows={s.by_agency} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CountTable title="Wydziały" rows={s.by_department} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CountTable title="Obywatelstwo" rows={s.by_country} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CountTable title="Stanowiska" rows={s.by_position} />
        </Grid.Col>
      </Grid>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm">
          <Title order={5}>Zatrudnienia i zwolnienia – ostatnie 12 miesięcy</Title>
          <Group gap="md">
            <Group gap={6}>
              <Box w={10} h={10} style={{ background: "var(--mantine-color-teal-6)", borderRadius: 2 }} />
              <Text size="xs">zatrudnieni</Text>
            </Group>
            <Group gap={6}>
              <Box w={10} h={10} style={{ background: "var(--mantine-color-red-5)", borderRadius: 2 }} />
              <Text size="xs">zwolnieni</Text>
            </Group>
          </Group>
        </Group>
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={4} withRowBorders={false}>
            <Table.Tbody>
              {s.months.map((m) => (
                <Table.Tr key={m.month}>
                  <Table.Td w={90}>
                    <Text size="sm">{m.label}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={3}>
                      <Bar value={m.hired} max={maxMonth} color="var(--mantine-color-teal-6)" />
                      <Bar value={m.terminated} max={maxMonth} color="var(--mantine-color-red-5)" />
                    </Stack>
                  </Table.Td>
                  <Table.Td w={120} ta="right">
                    <Text size="sm" span c="teal.7" fw={600}>
                      +{m.hired}
                    </Text>{" "}
                    <Text size="sm" span c="red.6" fw={600}>
                      −{m.terminated}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Card withBorder padding="lg">
        <Title order={5} mb="sm">
          APT × wydział
        </Title>
        <Table.ScrollContainer minWidth={420}>
          <Table striped verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>APT</Table.Th>
                <Table.Th>Wydział</Table.Th>
                <Table.Th ta="right">Aktywni</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.agency_department.map((r) => (
                <Table.Tr key={`${r.agency}|${r.department}`}>
                  <Table.Td>{r.agency}</Table.Td>
                  <Table.Td>{r.department}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {r.count}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Text size="xs" c="dimmed">
        Listę pracowników z dowolnymi filtrami pobierzesz w zakładce Pracownicy → przycisk „Excel”.
      </Text>
    </Stack>
  );
}
