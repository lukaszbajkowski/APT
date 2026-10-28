import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Avatar, Badge, Button, Center, Group, Loader, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle, IconCamera, IconCheck, IconClock } from "@tabler/icons-react";

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

  // odliczanie czasu linku (od pierwszego potwierdzenia daty urodzenia)
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!validUntil) return;
    const tick = () => setLeft(Math.max(0, Math.round((validUntil.getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [validUntil]);
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState(false);
  const baseline = useRef<string | null>(null);
  // link jest jednorazowy: po pierwszym zapisie zostaje 10 minut (tak samo liczy serwer)
  useEffect(() => {
    const x = data.data;
    if (!x) return;
    const sig = JSON.stringify([x.has_photo, x.photo_version, x.phone, x.email, x.phone_verified, x.email_verified]);
    if (baseline.current === null) baseline.current = sig;
    else if (baseline.current !== sig) {
      baseline.current = sig;
      setSaved(true);
      setValidUntil((v) => {
        const cap = new Date(Date.now() + 10 * 60_000);
        return v && v < cap ? v : cap;
      });
    }
  }, [data.data]);
  async function finish() {
    setBusy(true);
    try {
      await api(`${base}/finish`, { method: "POST" });
      setFinished(true);
      setLinkAccess(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const expired = unlocked && left === 0 && !finished;
  const clock = left === null ? "" : `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  const d = data.data;
  const photoUrl = d?.has_photo ? `/api${base}/photo?k=${encodeURIComponent(getLinkAccess() ?? "")}&v=${d.photo_version}` : undefined;
  return (
    <Center mih="100vh" className="surface-subtle" p="md">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={480}>
        <Stack>
          <Group justify="space-between" wrap="nowrap">
            <Title order={3} className="brand-title">
              Aktualizacja danych
            </Title>
            {unlocked && left !== null && !expired && (
              <Badge size="lg" variant="light" color={left < 120 ? "red" : "blue"} leftSection={<IconClock size={14} />} style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }} styles={{ root: { overflow: "visible" }, label: { overflow: "visible", textOverflow: "clip" } }}>
                {clock}
              </Badge>
            )}
          </Group>
          {expired && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              Czas na aktualizację minął. Poproś kadry o nowy link.
            </Alert>
          )}
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
          {finished && (
            <Alert color="green" icon={<IconCheck size={18} />}>
              Dziękujemy – dane zapisane, a link został zamknięty. Możesz zamknąć tę stronę.
            </Alert>
          )}
          {unlocked && !expired && !finished && d && (
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
                Zdjęcie zapisuje się od razu, telefon i e-mail po wpisaniu kodu. Pozostałe dane zmieniają kadry. Link jest
                jednorazowy – po pierwszym zapisie masz jeszcze 10 minut.
              </Alert>
              {saved && (
                <Button color="green" loading={busy} onClick={finish}>
                  Gotowe – zakończ
                </Button>
              )}
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
