import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Card, Group, SimpleGrid, Stack, Table, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { Chips, CompactEmpty, ListRow, PageHead, cap, PageTitle } from "../components/Mobile";

import { api, errorText } from "../api";
import { Loading } from "../components/States";

interface QualityCheck {
  key: string;
  label: string;
  count: number;
}
interface QualityRow {
  id: number;
  number: string;
  last_name: string;
  first_name: string;
  agency: string | null;
  department: string | null;
  missing: string[];
}
interface Quality {
  active_total: number;
  checks: QualityCheck[];
  rows: QualityRow[];
}

const SHORT: Record<string, string> = {
  pesel: "PESEL",
  sex: "płeć",
  photo: "zdjęcie",
  department: "wydział",
  position: "stanowisko",
  trainings: "wymagane szkolenia",
};

export function QualityPage() {
  const q = useQuery({ queryKey: ["quality"], queryFn: () => api<Quality>("/quality") });
  const [filter, setFilter] = useState<string | null>(null);
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });

  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert color="red">{errorText(q.error)}</Alert>;
  const data = q.data!;
  const rows = filter ? data.rows.filter((r) => r.missing.includes(filter)) : data.rows;

  if (mobile)
    return (
      <Stack gap="md">
        <PageHead
          title="Braki w danych"
          subtitle={data.rows.length ? `${data.rows.length} z ${data.active_total} aktywnych ma niepełną kartotekę` : "Wszystkie kartoteki są kompletne"}
        />
        {data.rows.length > 0 && (
          <Chips
            items={[
              { label: "Wszystkie", count: data.rows.length, active: !filter, onClick: () => setFilter(null) },
              ...data.checks
                .filter((c) => c.count > 0)
                .map((c) => ({ label: cap(SHORT[c.key] ?? c.label), count: c.count, active: filter === c.key, onClick: () => setFilter(filter === c.key ? null : c.key) })),
            ]}
          />
        )}
        {data.rows.length === 0 && (
          <CompactEmpty title="Wszystko uzupełnione" text="Żadnemu aktywnemu pracownikowi nie brakuje danych." />
        )}
        {data.rows.length > 0 && (
          <div className="ui-group">
            {rows.map((r) => (
              <ListRow
                key={r.id}
                to={`/pracownicy/${r.id}`}
                title={`${r.last_name} ${r.first_name}`}
                description={
                  <>
                    nr {r.number}
                    {r.agency || r.department ? ` · ${[r.agency, r.department].filter(Boolean).join(" · ")}` : ""}
                    <span className="ui-warn-line">
                      <IconAlertTriangle size={12} stroke={2.6} aria-hidden /> Brak: {r.missing.map((k) => SHORT[k] ?? k).join(", ")}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        )}
        <Text size="sm" c="dimmed">
          Przypomnienie e-mail wychodzi w poniedziałki do kadr i kierowników.
        </Text>
      </Stack>
    );

  return (
    <Stack>
      <PageTitle
        title="Braki w danych"
        description={
          <>
            Aktywni pracownicy z niekompletną kartoteką ({data.rows.length} z {data.active_total}). Przypomnienie e-mail
            wychodzi w poniedziałki do administratorów, HR i kierowników.
          </>
        }
      />

      {data.rows.length === 0 ? (
        <Alert color="green" icon={<IconCircleCheck />}>
          Wszystkie dane są kompletne.
        </Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: data.checks.length }} spacing="sm">
            {data.checks.map((c) => {
              const active = filter === c.key;
              return (
                <UnstyledButton key={c.key} onClick={() => setFilter(active ? null : c.key)} disabled={!c.count}>
                  <Card
                    withBorder
                    padding="sm"
                    style={{
                      borderColor: active ? "var(--mantine-primary-color-filled)" : undefined,
                      opacity: c.count ? 1 : 0.55,
                    }}
                  >
                    <Text size="xs" c="dimmed">
                      {c.label}
                    </Text>
                    <Text fw={700} size="xl" c={c.count ? "orange" : "teal"}>
                      {c.count}
                    </Text>
                  </Card>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
          {filter && (
            <Text size="sm">
              Filtr: {SHORT[filter]} ·{" "}
              <Anchor component="button" size="sm" onClick={() => setFilter(null)}>
                pokaż wszystkie
              </Anchor>
            </Text>
          )}
          <Card withBorder padding={0}>
            <Table highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pracownik</Table.Th>
                  <Table.Th>Brakuje</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/pracownicy/${r.id}`}>
                        {r.last_name} {r.first_name}
                      </Anchor>
                      <Text size="xs" c="dimmed">
                        nr {r.number}
                        {r.agency || r.department ? ` · ${[r.agency, r.department].filter(Boolean).join(" / ")}` : ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {r.missing.map((k) => (
                          <Badge key={k} variant="light" color="orange" size="sm">
                            {SHORT[k] ?? k}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}
    </Stack>
  );
}
