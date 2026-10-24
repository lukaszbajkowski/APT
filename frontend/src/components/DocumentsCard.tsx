import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
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
import { IconFileText, IconFileTypeDocx, IconFileTypePdf, IconPlus } from "@tabler/icons-react";

import { api, errorText, formatDateTime, LANGUAGES, type DocTemplate, type Employee, type GeneratedDoc, type TemplateField } from "../api";

type Values = Record<string, string | boolean | number | null>;

function FieldInput({ field, value, onChange }: { field: TemplateField; value: Values[string]; onChange: (v: Values[string]) => void }) {
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
  const [pdf, setPdf] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(() => templates.data?.find((t) => String(t.id) === templateId), [templates.data, templateId]);

  useEffect(() => {
    setValues({});
    setError(null);
  }, [templateId]);

  const generate = useMutation({
    mutationFn: () =>
      api<GeneratedDoc>(`/employees/${employee.id}/documents`, {
        method: "POST",
        body: { template_id: Number(templateId), values, pdf },
      }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents", employee.id] });
      qc.invalidateQueries({ queryKey: ["employee-history", String(employee.id)] });
      setOpen(false);
      if (doc.pdf_error) notifications.show({ color: "orange", message: `${doc.pdf_error} Pobieram plik Word.` });
      else notifications.show({ color: "green", message: "Dokument wygenerowany." });
      download(doc, doc.has_pdf ? "pdf" : "docx");
    },
    onError: (e) => setError(errorText(e)),
  });

  const missing = template?.fields.filter((f) => f.required && (values[f.key] === undefined || values[f.key] === "" || values[f.key] === null)) ?? [];
  const warnPesel = template?.builtins.includes("pesel") && employee.personal_data_visible && !employee.has_pesel;

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Dokumenty</Title>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            setTemplateId(templates.data?.length === 1 ? String(templates.data[0].id) : null);
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
                      <Text size="sm" fw={500}>
                        {d.template_name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatDateTime(d.created_at)} · {d.created_by_name ?? "—"}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td align="right">
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    {d.has_pdf && (
                      <Button size="compact-xs" variant="light" leftSection={<IconFileTypePdf size={14} />} onClick={() => download(d, "pdf")}>
                        PDF
                      </Button>
                    )}
                    <Button size="compact-xs" variant="default" leftSection={<IconFileTypeDocx size={14} />} onClick={() => download(d, "docx")}>
                      Word
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={open} onClose={() => setOpen(false)} title="Nowy dokument" size="lg">
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
            {warnPesel && (
              <Alert color="orange" variant="light">
                Ten pracownik nie ma wpisanego numeru PESEL – w dokumencie to pole zostanie puste.
              </Alert>
            )}
            {template && template.fields.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {template.fields.map((f) => (
                  <FieldInput key={f.key} field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                ))}
              </SimpleGrid>
            )}
            {template && (
              <Checkbox label="Utwórz także PDF (do druku)" checked={pdf} onChange={(e) => setPdf(e.currentTarget.checked)} />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                Anuluj
              </Button>
              <Button type="submit" loading={generate.isPending} disabled={!template || missing.length > 0}>
                Generuj i pobierz
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}
