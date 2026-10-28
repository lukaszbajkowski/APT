import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  ActionIcon,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCircleCheck, IconEye, IconFileText, IconFileTypeDocx, IconFileTypePdf, IconLock, IconMail, IconPlus, IconSignature, IconTrash } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { DocumentViewer } from "./DocumentViewer";
import { SignButton, SignatureBadge, SignaturesModal } from "./Signatures";
import { fieldMask, fieldProblem, maskExample, maskPartial, peselProblem, type FormatPreset } from "../masks";

import { api, errorText, formatDateTime, LANGUAGES, type DocTemplate, type Employee, type GeneratedDoc, type TemplateField, withAcct } from "../api";

export type Values = Record<string, string | boolean | number | null>;

export function useFieldFormats() {
  return useQuery({
    queryKey: ["template-formats"],
    queryFn: () => api<FormatPreset[]>("/templates/formats"),
    staleTime: Infinity,
  });
}

function MaskedText({ field, value, onChange }: { field: TemplateField; value: string; onChange: (v: string) => void }) {
  const formats = useFieldFormats();
  const [touched, setTouched] = useState(false);
  const mask = fieldMask(field, formats.data);
  const problem = touched ? fieldProblem(field, value, formats.data) : null;
  return (
    <TextInput
      label={field.label}
      description={field.help ?? undefined}
      required={field.required}
      placeholder={mask ? maskExample(mask) : field.format === "email" ? "nazwa@domena.pl" : undefined}
      inputMode={mask && !/[A*]/.test(mask) ? "numeric" : field.format === "email" ? "email" : undefined}
      value={value}
      error={problem ? `Oczekiwany ${problem}` : undefined}
      onBlur={() => setTouched(true)}
      onChange={(e) => onChange(mask ? maskPartial(e.currentTarget.value, mask) : e.currentTarget.value)}
      styles={mask ? { input: { fontFamily: "var(--mantine-font-family-monospace)" } } : undefined}
    />
  );
}

export function FieldInput({ field, value, onChange }: { field: TemplateField; value: Values[string]; onChange: (v: Values[string]) => void }) {
  if (field.type === "text" && field.format) {
    return <MaskedText field={field} value={(value as string) ?? ""} onChange={onChange} />;
  }
  const common = { label: field.label, description: field.help ?? undefined, required: field.required };
  switch (field.type) {
    case "select":
      return (
        <Select
          {...common}
          clearable={!field.required}
          data={field.options.map((o) => ({ value: o.value, label: o.label }))}
          value={(value as string) || null}
          onChange={(v) => onChange(v)}
        />
      );
    case "checkbox":
      return (
        <Checkbox
          mt="lg"
          label={field.label}
          description={field.help ?? undefined}
          checked={!!value}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case "date":
      return <TextInput {...common} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.currentTarget.value)} />;
    case "number":
      return <NumberInput {...common} value={(value as number) ?? ""} onChange={(v) => onChange(v === "" ? null : Number(v))} decimalSeparator="," />;
    case "textarea":
      return (
        <Textarea {...common} autosize minRows={2} value={(value as string) ?? ""} onChange={(e) => onChange(e.currentTarget.value)} />
      );
    default:
      return <TextInput {...common} value={(value as string) ?? ""} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
}

function EmailDocument({ doc, size }: { doc: GeneratedDoc; size: "compact-xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api<{ sent_to: string }>(`/documents/${doc.id}/email`, { method: "POST", body: { to: to.trim() || null, message: message.trim() || null } }),
    onSuccess: (r) => {
      notifications.show({ color: "green", message: `Wysłano na ${r.sent_to}.` });
      setOpen(false);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  return (
    <>
      <Button size={size} variant="default" leftSection={<IconMail size={14} />} onClick={() => { setTo(""); setMessage(""); setOpen(true); }}>
        E-mail
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Wyślij dokument e-mailem" size="md">
        <Stack>
          <Text size="sm">
            <b>{doc.template_name}</b> zostanie wysłany jako załącznik (wersja podpisana, jeśli dokument jest podpisany).
          </Text>
          <TextInput
            label="Adres e-mail"
            description="Zostaw puste, aby wysłać na potwierdzony e-mail pracownika."
            placeholder="np. osoba@example.com"
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
          <Textarea label="Wiadomość (opcjonalnie)" autosize minRows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.currentTarget.value)} />
          {doc.download.length > 0 && (
            <Text size="xs" c="dimmed">
              Wysłanie jest zapisywane w dzienniku zdarzeń. E-mail nie jest szyfrowany – nie wysyłaj dokumentów z danymi wrażliwymi na obce adresy.
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Anuluj
            </Button>
            <Button loading={send.isPending} onClick={() => send.mutate()}>
              Wyślij
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function DocActions({ doc, size = "compact-xs" }: { doc: GeneratedDoc; size?: "compact-xs" | "sm" }) {
  const [viewing, setViewing] = useState(false);
  if (!doc.accessible) {
    return (
      <Badge variant="light" color="gray" leftSection={<IconLock size={12} />}>
        zawiera dane wrażliwe
      </Badge>
    );
  }
  return (
    <Group gap={4} justify="flex-end" wrap="nowrap">
      {doc.can_view && (
        <Button size={size} variant="light" leftSection={<IconEye size={14} />} onClick={() => setViewing(true)}>
          Podgląd
        </Button>
      )}
      {viewing && <DocumentViewer docId={doc.id} opened onClose={() => setViewing(false)} />}
      {doc.download.includes("pdf") && (
        <Button size={size} variant="default" leftSection={<IconFileTypePdf size={14} />} onClick={() => download(doc, "pdf")}>
          PDF
        </Button>
      )}
      {doc.download.includes("docx") && (
        <Button size={size} variant="default" leftSection={<IconFileTypeDocx size={14} />} onClick={() => download(doc, "docx")}>
          Word
        </Button>
      )}
      {doc.download.length > 0 && <EmailDocument doc={doc} size={size} />}
    </Group>
  );
}

function DeleteDocument({ doc, employee }: { doc: GeneratedDoc; employee: Employee }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const signed = !!doc.signed_at || doc.has_signed_pdf;
  const del = useMutation({
    mutationFn: () => api(`/documents/${doc.id}/delete`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", employee.id] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
      qc.invalidateQueries({ queryKey: ["documents-trash", employee.id] });
      notifications.show({ color: "green", message: "Dokument przeniesiony do kosza." });
      setOpen(false);
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  if (!doc.can_delete) return null;
  return (
    <>
      <Tooltip label="Usuń dokument">
        <ActionIcon variant="subtle" color="red" size="sm" aria-label="Usuń dokument" onClick={() => { setReason(""); setOpen(true); }}>
          <IconTrash size={15} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={open} onClose={() => setOpen(false)} title="Usuń dokument" size="md">
        <Stack>
          <Text size="sm">
            <b>{doc.template_name}</b> z {formatDateTime(doc.created_at)} trafi do kosza na 30 dni (razem z plikami
            {signed ? ", podpisami i podpisaną wersją" : ""}), potem zostanie usunięty trwale. W tym czasie możesz go przywrócić. Prośby o podpis zostaną anulowane.
          </Text>
          {signed && (
            <Alert color="red" variant="light">
              Ten dokument jest już podpisany. Usuwaj go tylko wtedy, gdy podpis był pomyłką.
            </Alert>
          )}
          <Textarea
            label="Powód usunięcia"
            description="Zapisywany w dzienniku zdarzeń."
            placeholder="np. wygenerowany dla złej osoby, błędne dane w formularzu"
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

function download(doc: GeneratedDoc, format: "pdf" | "docx") {
  const a = document.createElement("a");
  a.href = withAcct(`/api/documents/${doc.id}/download?format=${format}`);
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface Trashed {
  id: string;
  template_name: string;
  deleted_at: string;
  deleted_by_name: string | null;
  delete_reason: string | null;
  purge_at: string;
  can_restore: boolean;
}

function TrashList({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const trash = useQuery({
    queryKey: ["documents-trash", employee.id],
    queryFn: () => api<Trashed[]>(`/employees/${employee.id}/documents/trash`),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", employee.id] });
      qc.invalidateQueries({ queryKey: ["documents-trash", employee.id] });
      notifications.show({ color: "green", message: "Dokument przywrócony." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  if (!trash.data?.length) return null;
  return (
    <Stack gap={4} mt="md">
      <Button variant="subtle" color="gray" size="compact-sm" w="fit-content" leftSection={<IconTrash size={14} />} onClick={() => setShow(!show)}>
        Kosz ({trash.data.length})
      </Button>
      {show &&
        trash.data.map((t) => (
          <Group key={t.id} justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Text size="sm">{t.template_name}</Text>
              <Text size="xs" c="dimmed">
                Usunięto {formatDateTime(t.deleted_at)}
                {t.deleted_by_name ? ` · ${t.deleted_by_name}` : ""}
                {t.delete_reason ? ` · ${t.delete_reason}` : ""} · zniknie na stałe {formatDateTime(t.purge_at)}
              </Text>
            </div>
            {t.can_restore && (
              <Button size="compact-xs" variant="light" loading={restore.isPending} onClick={() => restore.mutate(t.id)}>
                Przywróć
              </Button>
            )}
          </Group>
        ))}
    </Stack>
  );
}

export function DocumentsCard({ employee }: { employee: Employee }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isManager = hasRole("manager");
  const docs = useQuery({
    queryKey: ["documents", employee.id],
    queryFn: () => api<GeneratedDoc[]>(`/employees/${employee.id}/documents`),
  });
  const templates = useQuery({
    queryKey: ["templates", "active"],
    queryFn: () => api<DocTemplate[]>("/templates?active_only=true"),
  });

  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({});
  const [pesel, setPesel] = useState("");
  const [done, setDone] = useState<GeneratedDoc | null>(null);
  const [signDoc, setSignDoc] = useState<GeneratedDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(() => templates.data?.find((t) => String(t.id) === templateId), [templates.data, templateId]);

  useEffect(() => {
    const pre: Values = {};
    for (const f of template?.fields ?? []) {
      const k = f.key.toLowerCase();
      if (/^(e_?mail|mail)(_.*)?$/.test(k) && employee.contact_email) pre[f.key] = employee.contact_email;
      else if (/^(telefon|tel|phone|komorka)(_.*)?$/.test(k) && employee.contact_phone) pre[f.key] = employee.contact_phone;
    }
    setValues(pre);
    setPesel("");
    setError(null);
    setDone(null);
  }, [template, open, employee.contact_email, employee.contact_phone]);

  const generate = useMutation({
    mutationFn: () =>
      api<GeneratedDoc>(`/employees/${employee.id}/documents`, {
        method: "POST",
        body: { template_id: Number(templateId), values, pesel: askPesel && pesel.trim() ? pesel.trim() : null },
      }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents", employee.id] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
      if (askPesel && pesel.trim()) qc.invalidateQueries({ queryKey: ["employee", String(employee.id)] });
      setDone(doc);
      if (doc.pdf_error) notifications.show({ color: "orange", message: doc.pdf_error });
    },
    onError: (e) => setError(errorText(e)),
  });

  const missing = template?.fields.filter((f) => f.required && (values[f.key] === undefined || values[f.key] === "" || values[f.key] === null)) ?? [];
  const askPesel = !!template?.builtins.includes("pesel") && employee.personal_data_visible && !employee.has_pesel;
  const peselError = askPesel ? peselProblem(pesel) : null;
  const formats = useFieldFormats();
  const formatErrors = (template?.fields ?? []).filter(
    (f) => f.type === "text" && fieldProblem(f, String(values[f.key] ?? ""), formats.data),
  );
  const warnMasked = isManager && template?.sensitive;

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Dokumenty</Title>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            setTemplateId(templates.data?.length === 1 ? String(templates.data[0].id) : null);
            setValues({});
            setDone(null);
            setOpen(true);
          }}
          disabled={!templates.data?.length}
        >
          Generuj dokument
        </Button>
      </Group>
      {templates.data && templates.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak dostępnych szablonów. Administrator dodaje je w zakładce „Szablony”.
        </Text>
      )}
      {docs.isLoading && <Loader size="sm" />}
      {docs.data && docs.data.length === 0 && templates.data?.length !== 0 && (
        <Text size="sm" c="dimmed">
          Nie wygenerowano jeszcze żadnego dokumentu.
        </Text>
      )}
      {docs.data && docs.data.length > 0 && (
        <Table verticalSpacing={6}>
          <Table.Tbody>
            {docs.data.map((d) => (
              <Table.Tr key={d.id}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <IconFileText size={18} color="var(--mantine-color-gray-6)" />
                    <div>
                      <Group gap={6}>
                        <Text size="sm" fw={500}>
                          {d.template_name}
                        </Text>
                        <SignatureBadge doc={d} />
                      </Group>
                      <Text size="xs" c="dimmed">
                        {formatDateTime(d.created_at)} · {d.created_by_name ?? "—"}
                        {d.masked && " · bez PESEL i daty urodzenia"}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td align="right">
                  <Group gap={6} justify="flex-end" wrap="nowrap">
                    <SignButton doc={d} employee={employee} />
                    <DocActions doc={d} />
                    <DeleteDocument doc={d} employee={employee} />
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <TrashList employee={employee} />

      <Modal opened={open} onClose={() => setOpen(false)} title="Nowy dokument" size="lg">
        {done ? (
          <Stack>
            <Group gap="sm" wrap="nowrap">
              <IconCircleCheck size={32} color="var(--mantine-color-green-6)" />
              <div>
                <Text fw={600}>Gotowe: {done.template_name}</Text>
                <Text size="sm" c="dimmed">
                  Dokument jest też na liście w profilu pracownika.
                  {done.masked && " PESEL i data urodzenia zostały pominięte."}
                </Text>
              </div>
            </Group>
            {done.signature_roles?.length > 0 && done.accessible && (
              <Alert color="blue" variant="light" icon={<IconSignature />}>
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Text size="sm">
                    Dokument wymaga podpisu ({done.signature_roles.map((r) => (r === "pracownika" ? "pracownik" : "przedstawiciel firmy")).join(", ")}).
                  </Text>
                  <Button
                    size="xs"
                    leftSection={<IconSignature size={14} />}
                    onClick={() => {
                      setSignDoc(done);
                      setOpen(false);
                    }}
                  >
                    Przejdź do podpisu
                  </Button>
                </Group>
              </Alert>
            )}
            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setDone(null)}>
                Kolejny dokument
              </Button>
              <Group gap="xs">
                <DocActions doc={done} size="sm" />
                <Button variant="default" onClick={() => setOpen(false)}>
                  Zamknij
                </Button>
              </Group>
            </Group>
          </Stack>
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            generate.mutate();
          }}
        >
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <Select
              label="Szablon"
              placeholder="Wybierz"
              data={(templates.data ?? []).map((t) => ({
                value: String(t.id),
                label: `${t.name}${t.language !== "pl" ? ` (${LANGUAGES[t.language] ?? t.language})` : ""}`,
              }))}
              value={templateId}
              onChange={setTemplateId}
              allowDeselect={false}
            />
            {template?.description && (
              <Text size="sm" c="dimmed">
                {template.description}
              </Text>
            )}
            {template && (
              <Text size="xs" c="dimmed">
                Dane z kartoteki ({template.builtins.length}) zostaną wstawione automatycznie.
              </Text>
            )}
            {askPesel && (
              <TextInput
                label="PESEL pracownika"
                description="Pracownik nie ma PESEL w kartotece. Wpisany numer trafi do dokumentu i zostanie zapisany w kartotece (uzupełni też datę urodzenia i płeć). Puste pole = PESEL w dokumencie pozostanie pusty."
                placeholder="11 cyfr"
                inputMode="numeric"
                maxLength={11}
                value={pesel}
                onChange={(e) => setPesel(e.currentTarget.value.replace(/\D/g, ""))}
                error={pesel.length === 11 || pesel.length === 0 ? peselError : undefined}
                styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", letterSpacing: 1 } }}
              />
            )}
            {template && template.fields.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {template.fields.map((f) => (
                  <FieldInput key={f.key} field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                ))}
              </SimpleGrid>
            )}
            {warnMasked && (
              <Alert color="blue" variant="light">
                Ten szablon zawiera PESEL lub datę urodzenia – w Twoim dokumencie te pola zostaną puste.
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                Anuluj
              </Button>
              <Button type="submit" loading={generate.isPending} disabled={!template || missing.length > 0 || !!peselError || formatErrors.length > 0}>
                Generuj
              </Button>
            </Group>
          </Stack>
        </form>
        )}
      </Modal>
      {signDoc && <SignaturesModal doc={signDoc} employee={employee} opened onClose={() => setSignDoc(null)} />}
    </Card>
  );
}
