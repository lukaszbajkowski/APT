import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Group, Loader, Modal, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBan } from "@tabler/icons-react";

import { api, errorText, formatDate, formatDateTime, REVOKE_LABELS, type CardInfo, type CardState, type Employee } from "../api";
import { useAuth } from "../auth";

export const CARD_STATE: Record<CardState, { label: string; color: string }> = {
  valid: { label: "ważna", color: "green" },
  expired: { label: "po terminie", color: "orange" },
  replaced: { label: "zastąpiona nowszą", color: "gray" },
  revoked: { label: "unieważniona", color: "red" },
};

export function CardsHistory({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canRevoke = hasRole("admin", "hr", "manager");
  const cards = useQuery({
    queryKey: ["cards", employee.id],
    queryFn: () => api<CardInfo[]>(`/cards/employee/${employee.id}`),
  });
  const [target, setTarget] = useState<CardInfo | null>(null);
  const [reason, setReason] = useState<string | null>("lost");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: () => api(`/cards/${target!.id}/revoke`, { method: "POST", body: { reason, note: note || null } }),
    onSuccess: () => {
      notifications.show({ color: "green", message: "Karta unieważniona – skaner pokaże ją jako nieważną." });
      setTarget(null);
      qc.invalidateQueries({ queryKey: ["cards", employee.id] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setError(errorText(e)),
  });

  return (
    <Card withBorder padding="lg">
      <Title order={5} mb="sm">
        Karty identyfikacyjne
      </Title>
      {cards.isLoading && <Loader size="sm" />}
      {cards.data && cards.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak kart w rejestrze. Karty wydrukowane przed wprowadzeniem rejestru nie mają numeru wersji – przy
          skanowaniu są oznaczone jako „stara karta”.
        </Text>
      )}
      {cards.data && cards.data.length > 0 && (
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Karta</Table.Th>
                <Table.Th>Stan</Table.Th>
                <Table.Th>Wydana</Table.Th>
                <Table.Th>Ważna do</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cards.data.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {c.code}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={CARD_STATE[c.state].color}>
                      {CARD_STATE[c.state].label}
                    </Badge>
                    {c.revoke_reason && (
                      <Text size="xs" c="dimmed">
                        {REVOKE_LABELS[c.revoke_reason] ?? c.revoke_reason}
                        {c.revoke_note ? ` – ${c.revoke_note}` : ""}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDateTime(c.issued_at)}</Text>
                    <Text size="xs" c="dimmed">
                      {c.issued_by_name ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>{c.valid_until ? formatDate(c.valid_until) : "bezterminowo"}</Table.Td>
                  <Table.Td align="right">
                    {canRevoke && (c.state === "valid" || c.state === "expired") && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconBan size={14} />}
                        onClick={() => {
                          setTarget(c);
                          setReason("lost");
                          setNote("");
                          setError(null);
                        }}
                      >
                        Unieważnij
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={!!target} onClose={() => setTarget(null)} title={`Unieważnienie karty ${target?.code ?? ""}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            revoke.mutate();
          }}
        >
          <Stack>
            <Text size="sm">
              Po unieważnieniu skaner pokaże tę kartę jako nieważną. Aby wydać nową, wydrukuj kartę ponownie.
            </Text>
            {error && <Alert color="red">{error}</Alert>}
            <Select
              label="Powód"
              allowDeselect={false}
              data={[
                { value: "lost", label: "zgubiona" },
                { value: "damaged", label: "zniszczona" },
                { value: "other", label: "inny powód" },
              ]}
              value={reason}
              onChange={setReason}
            />
            <TextInput label="Uwagi (opcjonalnie)" maxLength={300} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setTarget(null)}>
                Anuluj
              </Button>
              <Button type="submit" color="red" loading={revoke.isPending}>
                Unieważnij kartę
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}
