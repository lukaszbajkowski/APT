import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Avatar, Button, Center, Group, Loader, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconCamera, IconCheck } from "@tabler/icons-react";

import { api, errorText, getLinkAccess, setLinkAccess } from "../api";
import { ContactEditor } from "../components/MyDataCards";
import { PhotoEditor } from "../components/PhotoEditor";
import type { Employee } from "../api";

interface Data {
  first_name: string;
  last_name: string;
  has_photo: boolean;
  photo_version: string | null;
  phone: string | null;
  phone_verified: boolean;
  email: string | null;
  email_verified: boolean;
}

/** Publiczna strona „aktualizacja danych” dla pracownika bez konta (link od kadr + data urodzenia). */
export function DataLinkPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const qc = useQueryClient();
  const base = `/data-link/${encodeURIComponent(token)}`;
  const [unlocked, setUnlocked] = useState(false);
  const [birth, setBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validUntil, setValidUntil] = useState<Date | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const info = useQuery({
    queryKey: ["data-link", token],
    queryFn: () => api<{ first_name: string }>(base),
    enabled: !!token,
    retry: false,
  });
  const dataKey = ["data-link-data", token];
  const data = useQuery({ queryKey: dataKey, queryFn: () => api<Data>(`${base}/data`), enabled: unlocked });

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ access: string; valid_until: string }>(`${base}/verify`, { method: "POST", body: { birth_date: birth } });
      setLinkAccess(r.access);
      setValidUntil(new Date(r.valid_until));
      setUnlocked(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const d = data.data;
  const photoUrl = d?.has_photo ? `/api${base}/photo?k=${encodeURIComponent(getLinkAccess() ?? "")}&v=${d.photo_version}` : undefined;
  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={480}>
        <Stack>
          <Title order={3} className="brand-title">
            Aktualizacja danych
          </Title>
          {info.isLoading && <Loader />}
          {(info.isError || !token) && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {info.error ? errorText(info.error) : "Link jest nieprawidłowy."} Poproś kadry o nowy.
            </Alert>
          )}
          {info.data && !unlocked && (
            <>
              <Text size="sm">{info.data.first_name}, potwierdź datę urodzenia, aby zaktualizować zdjęcie i dane kontaktowe. Po potwierdzeniu masz na to 15 minut.</Text>
              {error && (
                <Alert color="red" icon={<IconAlertCircle size={18} />}>
                  {error}
                </Alert>
              )}
              <TextInput label="Data urodzenia" type="date" value={birth} onChange={(e) => setBirth(e.currentTarget.value)} />
              <Button size="md" loading={busy} disabled={!birth} onClick={verify}>
                Dalej
              </Button>
            </>
          )}
          {unlocked && data.error && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {errorText(data.error)}
            </Alert>
          )}
          {unlocked && d && (
            <>
              <Group>
                <Avatar size={72} radius="md" src={photoUrl}>
                  {d.first_name[0]}
                  {d.last_name[0]}
                </Avatar>
                <div>
                  <Text fw={600}>
                    {d.first_name} {d.last_name}
                  </Text>
                  <Button size="xs" variant="light" leftSection={<IconCamera size={14} />} onClick={() => setPhotoOpen(true)}>
                    {d.has_photo ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
                  </Button>
                </div>
              </Group>
              <ContactEditor kind="phone" current={d.phone} verified={d.phone_verified} base={`${base}/contact`} queryKey={dataKey} />
              <ContactEditor kind="email" current={d.email} verified={d.email_verified} base={`${base}/contact`} queryKey={dataKey} />
              <Alert color="green" icon={<IconCheck size={18} />}>
                Zdjęcie zapisuje się od razu, telefon i e-mail po wpisaniu kodu.
                {validUntil ? ` Ten link działa do ${validUntil.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} – potem poproś kadry o nowy.` : ""}
                {" "}Pozostałe dane zmieniają kadry.
              </Alert>
              <PhotoEditor
                employee={{ id: 0, first_name: d.first_name, last_name: d.last_name } as unknown as Employee}
                opened={photoOpen}
                onClose={() => setPhotoOpen(false)}
                endpoint={`${base}/photo`}
                onSaved={() => qc.invalidateQueries({ queryKey: dataKey })}
              />
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
