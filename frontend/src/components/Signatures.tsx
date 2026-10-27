import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  CopyButton,
  Divider,
  FileButton,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDeviceMobile,
  IconExternalLink,
  IconFileCertificate,
  IconFileUpload,
  IconMail,
  IconMessage,
  IconQrcode,
  IconSignature,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import { api, errorText, formatDateTime, type Employee, type GeneratedDoc } from "../api";

interface RoleState {
  role: string;
  label: string;
  status: "none" | "pending" | "signed" | "expired";
  request_id: number | null;
  channel: string | null;
  sent_to: string | null;
  expires_at: string | null;
  signer_name: string | null;
  signed_at: string | null;
  method: string | null;
  device_check: boolean;
  device_verified: boolean;
  check: { level: "qualified" | "valid" | "unverified" | "invalid"; label: string; signer?: string | null; issuer?: string | null; notes?: string[] } | null;
}
interface SignaturesState {
  roles: RoleState[];
  signed_at: string | null;
  has_signed_pdf: boolean;
  scan: boolean;
  scan_id: number | null;
  scan_allowed: boolean;
  can_remove: boolean;
  can_download: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  integrity: "ok" | "mismatch" | "unknown";
  timestamp: { gen_time: string; tsa: string | null; tsa_url: string | null; trusted: boolean | null } | null;
  timestamp_enabled: boolean;
}
interface RequestResult {
  id: number;
  link: string;
  expires_at: string;
  sent: boolean;
  qr_svg: string;
}

const METHOD: Record<string, string> = {
  ekran: "na ekranie",
  zaufany: "podpis zaufany / kwalifikowany",
  skan: "skan papieru",
};

function methodLabel(r: RoleState): string {
  if (r.method === "zaufany" && r.check?.level === "qualified") return "podpis kwalifikowany";
  return METHOD[r.method ?? ""] ?? r.method ?? "";
}

export function SignatureBadge({ doc }: { doc: GeneratedDoc }) {
  if (doc.signed_at)
    return (
      <Badge size="xs" color="teal" variant="light" leftSection={<IconCheck size={10} />}>
        podpisany
      </Badge>
    );
  if (doc.signature_pending)
    return (
      <Badge size="xs" color="orange" variant="light">
        czeka na podpis
      </Badge>
    );
  if (doc.has_signed_pdf)
    return (
      <Badge size="xs" color="blue" variant="light">
        podpisany częściowo
      </Badge>
    );
  if (doc.signature_roles?.length)
    return (
      <Badge size="xs" color="gray" variant="light">
        do podpisu
      </Badge>
    );
  return null;
}

function RoleRequest({ doc, employee, r, st, onDone }: { doc: GeneratedDoc; employee: Employee; r: RoleState; st: SignaturesState; onDone: () => void }) {
  const [channel, setChannel] = useState<string>(st.email_enabled ? "email" : "link");
  const [to, setTo] = useState("");
  const [deviceCheck, setDeviceCheck] = useState(r.role === "pracownika");
  const [result, setResult] = useState<RequestResult | null>(null);
  const send = useMutation({
    mutationFn: () =>
      api<RequestResult>(`/documents/${doc.id}/signatures`, {
        method: "POST",
        body: { role: r.role, channel, to: channel === "link" ? null : to, device_check: deviceCheck },
      }),
    onSuccess: (res) => {
      setResult(res);
      onDone();
      if (res.sent) notifications.show({ color: "green", message: channel === "sms" ? "Wysłano SMS z linkiem." : "Wysłano e-mail z linkiem." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });

  if (result)
    return (
      <Stack gap="xs">
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Box w={130} h={130} style={{ flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: result.qr_svg }} />
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Text size="sm">
              {result.sent ? "Link wysłany. " : ""}Osoba może też zeskanować kod QR telefonem albo podpisać na tym urządzeniu.
            </Text>
            <Text size="xs" c="dimmed">
              Link jest jednorazowy, ważny do {formatDateTime(result.expires_at)}.
            </Text>
            <Group gap="xs">
              <CopyButton value={result.link}>
                {({ copied, copy }) => (
                  <Button size="xs" variant="default" leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
                    {copied ? "Skopiowano" : "Kopiuj link"}
                  </Button>
                )}
              </CopyButton>
              <Button size="xs" variant="light" component="a" href={result.link} target="_blank" leftSection={<IconExternalLink size={14} />}>
                Podpisz na tym urządzeniu
              </Button>
            </Group>
          </Stack>
        </Group>
      </Stack>
    );

  const placeholder = channel === "email" ? "adres e-mail" : "numer telefonu, np. 600 100 200";
  return (
    <Stack gap="xs">
      <SegmentedControl
        size="xs"
        value={channel}
        onChange={setChannel}
        data={[
          { value: "email", label: "E-mail", disabled: !st.email_enabled },
          { value: "sms", label: st.sms_enabled ? "SMS" : "SMS (nieskonfigurowany)", disabled: !st.sms_enabled },
          { value: "link", label: "Link / kod QR" },
        ]}
      />
      <Group gap="xs" align="flex-end" wrap="nowrap">
        {channel !== "link" && (
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            placeholder={placeholder}
            leftSection={channel === "email" ? <IconMail size={14} /> : <IconDeviceMobile size={14} />}
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
            type={channel === "email" ? "email" : "tel"}
          />
        )}
        <Button
          size="xs"
          leftSection={channel === "link" ? <IconQrcode size={14} /> : <IconMessage size={14} />}
          onClick={() => send.mutate()}
          loading={send.isPending}
          disabled={channel !== "link" && !to.trim()}
        >
          {channel === "link" ? "Utwórz link" : "Wyślij"}
        </Button>
      </Group>
      <Checkbox
        size="xs"
        checked={deviceCheck}
        onChange={(e) => setDeviceCheck(e.currentTarget.checked)}
        label="Wymagaj potwierdzenia blokadą telefonu (Face ID, odcisk palca lub PIN)"
        description="Dotyczy podpisu na ekranie. Gdy telefon tego nie obsługuje, osoba może wgrać plik z podpisem zaufanym lub kwalifikowanym albo dostać nowy link bez tego wymogu."
      />
      {r.role === "pracownika" && !employee.birth_date && (
        <Text size="xs" c="orange">
          Pracownik nie ma daty urodzenia w kartotece – strona podpisu nie poprosi o jej potwierdzenie.
        </Text>
      )}
    </Stack>
  );
}

function RemoveSignature({ id, what, docId, onDone }: { id: number; what: string; docId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const del = useMutation({
    mutationFn: () => api(`/signatures/${id}/remove`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: () => {
      setOpen(false);
      onDone();
      notifications.show({ color: "green", message: `Usunięto ${what}.` });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  return (
    <>
      <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => { setReason(""); setOpen(true); }}>
        Usuń {what}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Usuń ${what}`} size="md" zIndex={400} key={docId}>
        <Stack>
          <Text size="sm">
            Plik zostanie trwale usunięty, a dokument wróci do stanu „do podpisu” – można go podpisać ponownie. Pozostałe podpisy zostają.
          </Text>
          <Textarea
            label="Powód"
            description="Zapisywany w dzienniku zdarzeń."
            placeholder="np. podpisała niewłaściwa osoba, zły plik"
            autosize
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Anuluj
            </Button>
            <Button color="red" leftSection={<IconTrash size={14} />} loading={del.isPending} disabled={reason.trim().length < 3} onClick={() => del.mutate()}>
              Usuń
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function SignaturesModal({ doc, employee, opened, onClose }: { doc: GeneratedDoc; employee: Employee; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["signatures", doc.id],
    queryFn: () => api<SignaturesState>(`/documents/${doc.id}/signatures`),
    enabled: opened,
    refetchInterval: opened ? 10000 : false,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["signatures", doc.id] });
    qc.invalidateQueries({ queryKey: ["documents", employee.id] });
  };
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/signatures/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const scan = useMutation({
    mutationFn: (file: File) => {
      const f = new FormData();
      f.append("file", file);
      return api(`/documents/${doc.id}/signatures/scan`, { method: "POST", form: f });
    },
    onSuccess: () => {
      refresh();
      notifications.show({ color: "green", message: "Dołączono skan – dokument oznaczony jako podpisany." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  const st = q.data;
  return (
    <Modal opened={opened} onClose={onClose} title={`Podpis: ${doc.template_name}`} size="lg">
      {!st ? (
        <Loader />
      ) : (
        <Stack>
          {st.integrity === "mismatch" && (
            <Alert color="red" icon={<IconAlertTriangle />} title="Plik różni się od zapisanego przy podpisie">
              Skrót pliku podpisanego dokumentu nie zgadza się z wpisem w dzienniku zdarzeń z chwili podpisu. Plik mógł zostać
              zmieniony poza aplikacją. Nie przekazuj go dalej i zgłoś to administratorowi.
            </Alert>
          )}
          {st.signed_at && (
            <Alert color="teal" icon={<IconCheck />}>
              Dokument podpisany {formatDateTime(st.signed_at)}.
              {st.integrity === "ok" && " Plik zgodny z dziennikiem zdarzeń."}
              {st.timestamp && (
                <>
                  <br />
                  Zaufany znacznik czasu: {formatDateTime(st.timestamp.gen_time)} ({st.timestamp.tsa ?? "usługa czasu"}
                  {st.timestamp.trusted === false ? ", urząd niezaufany" : ""}; niekwalifikowany).{" "}
                  {st.can_download && (
                    <a href={`/api/documents/${doc.id}/timestamp`}>Pobierz znacznik (.tsr)</a>
                  )}
                </>
              )}
              {!st.timestamp && st.timestamp_enabled && (
                <>
                  <br />
                  Znacznik czasu: oczekuje – zostanie dodany automatycznie.
                </>
              )}
            </Alert>
          )}
          {st.roles.length === 0 && (
            <Text size="sm" c="dimmed">
              Ten szablon nie ma miejsca na podpis na ekranie. Dodaj w Wordzie znaczniki {"{{ podpis_pracownika }}"} i{" "}
              {"{{ data_podpisu_pracownika }}"} albo dołącz skan podpisanego papieru.
            </Text>
          )}
          {st.roles.map((r) => (
            <Paper key={r.role} withBorder p="sm" radius="md">
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  {r.label}
                </Text>
                {r.status === "signed" ? (
                  <Badge color="teal" variant="light">
                    podpisano
                  </Badge>
                ) : r.status === "pending" ? (
                  <Badge color="orange" variant="light">
                    czeka
                  </Badge>
                ) : r.status === "expired" ? (
                  <Badge color="gray" variant="light">
                    link wygasł
                  </Badge>
                ) : (
                  <Badge color="gray" variant="outline">
                    niepodpisano
                  </Badge>
                )}
              </Group>
              {r.status === "signed" ? (
                <Stack gap={4}>
                  <Text size="sm">
                    {r.signer_name} · {formatDateTime(r.signed_at)} · {methodLabel(r)}
                  </Text>
                  {r.device_verified && (
                    <Text size="xs" c="teal.7">
                      Potwierdzono blokadą urządzenia (biometria lub kod telefonu).
                    </Text>
                  )}
                  {r.check && (
                    <Text size="xs" c={r.check.level === "qualified" ? "teal.7" : r.check.level === "invalid" ? "red" : "dimmed"}>
                      Sprawdzenie podpisu w pliku: {r.check.label}
                      {r.check.signer ? ` · ${r.check.signer}` : ""}
                      {r.check.notes?.length ? ` · ${r.check.notes[0]}` : ""}
                    </Text>
                  )}
                  {st.can_remove && r.request_id && (
                    <Group justify="flex-end">
                      <RemoveSignature id={r.request_id} what="podpis" docId={doc.id} onDone={refresh} />
                    </Group>
                  )}
                </Stack>
              ) : (
                <>
                  {r.status === "pending" && (
                    <Group justify="space-between" mb="xs">
                      <Text size="xs" c="dimmed">
                        Wysłano {r.channel === "link" ? "jako link" : `na ${r.sent_to}`} · ważny do {formatDateTime(r.expires_at)}
                      </Text>
                      <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconX size={12} />} onClick={() => r.request_id && cancel.mutate(r.request_id)}>
                        Anuluj
                      </Button>
                    </Group>
                  )}
                  <RoleRequest key={r.role} doc={doc} employee={employee} r={r} st={st} onDone={refresh} />
                </>
              )}
            </Paper>
          ))}
          <Divider />
          <Group justify="space-between">
            {st.scan_allowed && (
              <FileButton accept="application/pdf,image/jpeg,image/png" onChange={(f) => f && scan.mutate(f)}>
                {(props) => (
                  <Button {...props} size="xs" variant="default" leftSection={<IconFileUpload size={14} />} loading={scan.isPending}>
                    {st.scan ? "Zmień skan podpisanego papieru" : "Dołącz skan podpisanego papieru"}
                  </Button>
                )}
              </FileButton>
            )}
            {st.can_remove && st.scan_id && <RemoveSignature id={st.scan_id} what="skan" docId={doc.id} onDone={refresh} />}
            <Box style={{ flex: 1 }} />
            {(st.has_signed_pdf || st.scan) && st.can_download && (
              <Button size="xs" component="a" href={`/api/documents/${doc.id}/signed`} leftSection={<IconFileCertificate size={14} />}>
                Pobierz podpisany
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export function SignButton({ doc, employee }: { doc: GeneratedDoc; employee: Employee }) {
  const [open, setOpen] = useState(false);
  if (!doc.accessible) return null;
  return (
    <>
      <Button size="compact-xs" variant={doc.signed_at ? "subtle" : "light"} leftSection={<IconSignature size={14} />} onClick={() => setOpen(true)}>
        Podpis
      </Button>
      {open && <SignaturesModal doc={doc} employee={employee} opened={open} onClose={() => setOpen(false)} />}
    </>
  );
}
