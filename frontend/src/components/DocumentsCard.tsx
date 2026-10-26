import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
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
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCircleCheck, IconEye, IconFileText, IconFileTypeDocx, IconFileTypePdf, IconLock, IconPlus } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { SignButton, SignatureBadge } from "./Signatures";
import { fieldMask, fieldProblem, maskExample, maskPartial, peselProblem, type FormatPreset } from "../masks";

import { api, errorText, formatDateTime, LANGUAGES, type DocTemplate, type Employee, type GeneratedDoc, type TemplateField } from "../api";

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

function viewOnline(doc: GeneratedDoc) {
  window.open(`/api/documents/${doc.id}/view`, "_blank", "noopener");
}

function DocActions({ doc, size = "compact-xs" }: { doc: GeneratedDoc; size?: "compact-xs" | "sm" }) {
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
        <Button size={size} variant="light" leftSection={<IconEye size={14} />} onClick={() => viewOnline(doc)}>
          Podgląd
        </Button>
      )}
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
    </Group>
  );
}

function download(doc: GeneratedDoc, format: "pdf" | "docx") {
  const a = document.createElement("a");
  a.href = `/api/documents/${doc.id}/download?format=${format}`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(() => templates.data?.find((t) => String(t.id) === templateId), [templates.data, templateId]);

  useEffect(() => {
    setValues({});
    setPesel("");
    setError(null);
    setDone(null);
  }, [templateId]);

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
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

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
    </Card>
  );
}
