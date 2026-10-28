import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Avatar, Badge, Button, Card, Group, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCamera, IconMail, IconPhone } from "@tabler/icons-react";

import { api, errorText, formatDate, withAcct, type Employee } from "../api";
import { PhotoEditor } from "./PhotoEditor";

export interface MyEmployee {
  number: string;
  first_name: string;
  last_name: string;
  sex: string | null;
  birth_date: string | null;
  pesel_masked: string | null;
  country: string | null;
  agency: string | null;
  department: string | null;
  position: string | null;
  hire_date: string | null;
  termination_date: string | null;
  status: string;
  has_photo: boolean;
  photo_version: string | null;
  phone: string | null;
  phone_verified: boolean;
  email: string | null;
  email_verified: boolean;
  has_passkey: boolean;
}

interface History {
  periods: { hire_date: string | null; termination_date: string | null; agency: string | null; department: string | null; position: string | null; current: boolean }[];
  assignments: { valid_from: string; agency: string | null; department: string | null; position: string | null }[];
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right">
        {value || "—"}
      </Text>
    </Group>
  );
}

export function ContactEditor({
  kind,
  current,
  verified,
  base = "/me/contact",
  queryKey = ["my-employee"],
}: {
  kind: "phone" | "email";
  current: string | null;
  verified: boolean;
  base?: string;
  queryKey?: unknown[];
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMail = kind === "email";
  const done = (data: unknown) => {
    qc.setQueryData(queryKey, data);
    setSentTo(null);
    setValue("");
    setCode("");
    setError(null);
  };
  const start = useMutation({
    mutationFn: () => api<{ sent_to: string }>(`${base}/${kind}/start`, { method: "POST", body: { value } }),
    onSuccess: (r) => {
      setError(null);
      setSentTo(r.sent_to);
    },
    onError: (e) => setError(errorText(e)),
  });
  const confirm = useMutation({
    mutationFn: () => api<unknown>(`${base}/${kind}/confirm`, { method: "POST", body: { code } }),
    onSuccess: (d) => {
      done(d);
      notifications.show({ color: "green", message: isMail ? "Zapisano adres e-mail." : "Zapisano numer telefonu." });
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api<unknown>(`${base}/${kind}`, { method: "DELETE" }),
    onSuccess: done,
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          {isMail ? <IconMail size={18} /> : <IconPhone size={18} />}
          <Text size="sm" fw={500}>
            {isMail ? "E-mail" : "Telefon"}: {current ?? "nie podano"}
          </Text>
          {current && <Badge color={verified ? "green" : "gray"}>{verified ? "potwierdzony" : "niepotwierdzony"}</Badge>}
        </Group>
        {current && (
          <Button size="xs" variant="subtle" color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
            Usuń
          </Button>
        )}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {sentTo ? (
        <Group align="flex-end">
          <TextInput
            label={`Kod wysłany na ${sentTo}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
          <Button loading={confirm.isPending} disabled={code.length < 4} onClick={() => confirm.mutate()}>
            Potwierdź
          </Button>
          <Button variant="default" onClick={() => setSentTo(null)}>
            Anuluj
          </Button>
        </Group>
      ) : (
        <Group align="flex-end">
          <TextInput
            label={current ? "Nowa wartość" : isMail ? "Adres e-mail" : "Numer telefonu"}
            type={isMail ? "email" : "tel"}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
          <Button loading={start.isPending} disabled={value.length < 3} onClick={() => start.mutate()}>
            Wyślij kod
          </Button>
        </Group>
      )}
    </Stack>
  );
}

export function MyDataCards() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const photoOpen = params.get("zdjecie") === "1";
  const setPhotoOpen = (v: boolean) => setParams(v ? { zdjecie: "1" } : {});
  const mine = useQuery({ queryKey: ["my-employee"], queryFn: () => api<MyEmployee>("/me/employee"), refetchInterval: 30_000, refetchOnWindowFocus: true });
  const history = useQuery({ queryKey: ["my-history"], queryFn: () => api<History>("/me/history"), refetchInterval: 60_000, refetchOnWindowFocus: true });
  const d = mine.data;
  if (!d) return null;
  const asEmployee = { id: 0, first_name: d.first_name, last_name: d.last_name } as unknown as Employee;
  return (
    <>
      <Card withBorder padding="lg">
        <Group align="flex-start" wrap="nowrap">
          <Stack align="center" gap="xs">
            <Avatar size={96} radius="md" src={d.has_photo ? withAcct(`/api/me/photo?v=${d.photo_version}`) : null}>
              {d.first_name[0]}
              {d.last_name[0]}
            </Avatar>
            <Button size="xs" variant="light" leftSection={<IconCamera size={14} />} onClick={() => setPhotoOpen(true)}>
              {d.has_photo ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
            </Button>
          </Stack>
          <Stack gap={4} style={{ flex: 1 }}>
            <Title order={4}>
              {d.first_name} {d.last_name}
            </Title>
            <Row label="Numer ewidencyjny" value={d.number} />
            <Row label="Data urodzenia" value={d.birth_date ? formatDate(d.birth_date) : null} />
            <Row label="PESEL" value={d.pesel_masked} />
            <Row label="Obywatelstwo" value={d.country} />
            <Row label="Agencja" value={d.agency} />
            <Row label="Wydział" value={d.department} />
            <Row label="Stanowisko" value={d.position} />
            <Row label="Zatrudniony od" value={d.hire_date ? formatDate(d.hire_date) : null} />
            <Text size="xs" c="dimmed" mt="xs">
              Imię, nazwisko, obywatelstwo, płeć i PESEL zmieniają wyłącznie kadry – zgłoś to poza aplikacją.
            </Text>
          </Stack>
        </Group>
      </Card>
      <Card withBorder padding="lg" id="kontakt">
        <Title order={4} mb="xs">
          Dane kontaktowe
        </Title>
        <Text size="xs" c="dimmed" mb="sm">
          Widzą je tylko kadry i administrator. Zmiana wymaga kodu wysłanego na nowy numer lub adres.
        </Text>
        <Stack>
          <ContactEditor kind="phone" current={d.phone} verified={d.phone_verified} />
          <ContactEditor kind="email" current={d.email} verified={d.email_verified} />
        </Stack>
      </Card>
      {history.data && (history.data.periods.length > 0 || history.data.assignments.length > 0) && (
        <Card withBorder padding="lg">
          <Title order={4} mb="xs">
            Historia zatrudnienia
          </Title>
          <Table.ScrollContainer minWidth={420}>
            <Table fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Okres</Table.Th>
                  <Table.Th>Agencja</Table.Th>
                  <Table.Th>Wydział</Table.Th>
                  <Table.Th>Stanowisko</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.data.periods.map((p, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      {p.hire_date ? formatDate(p.hire_date) : "?"} – {p.termination_date ? formatDate(p.termination_date) : "obecnie"}
                    </Table.Td>
                    <Table.Td>{p.agency ?? "—"}</Table.Td>
                    <Table.Td>{p.department ?? "—"}</Table.Td>
                    <Table.Td>{p.position ?? "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {history.data.assignments.length > 0 && (
            <>
              <Text size="sm" fw={500} mt="md" mb={4}>
                Zmiany wydziału i stanowiska
              </Text>
              <Table fz="sm">
                <Table.Tbody>
                  {history.data.assignments.map((a, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>od {formatDate(a.valid_from)}</Table.Td>
                      <Table.Td>{a.department ?? "—"}</Table.Td>
                      <Table.Td>{a.position ?? "—"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Card>
      )}
      <PhotoEditor
        employee={asEmployee}
        opened={photoOpen}
        onClose={() => setPhotoOpen(false)}
        endpoint="/me/photo"
        onSaved={() => qc.invalidateQueries({ queryKey: ["my-employee"] })}
      />
    </>
  );
}
