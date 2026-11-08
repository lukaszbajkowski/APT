import { useMediaQuery } from "@mantine/hooks";
import { ActionSheet, CompactEmpty, ListRow, Section, StatusBadge, type SheetAction, FormDialog } from "./Mobile";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Collapse, Badge, Anchor, Button, ActionIcon, Menu, Checkbox, Group, Modal, NumberInput, SimpleGrid, Stack, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { Select } from "./AptSelect";
import { notifications } from "@mantine/notifications";
import { IconChevronDown, IconChevronUp, IconBell, IconCircleCheck, IconDots, IconEye, IconFileText, IconFileTypeDocx, IconFileTypePdf, IconLock, IconMail, IconPlus, IconSignature, IconTrash } from "@tabler/icons-react";

import { useAuth } from "../auth";
import { DocumentViewer } from "./DocumentViewer";
import { SignaturesModal, useRemindSignature } from "./Signatures";
import { fieldMask, fieldProblem, maskExample, maskPartial, peselProblem, type FormatPreset } from "../masks";

import { api, errorText, formatDateTime, LANGUAGES, type DocTemplate, type Employee, type GeneratedDoc, type TemplateField, withAcct } from "../api";
import { Loading } from "./States";
import { DateField } from "./DateField";

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
      return <DateField {...common}  value={(value as string) ?? ""} onChange={(e) => onChange(e.currentTarget.value)} />;
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

function EmailDocument({ doc, size, opened, onClose }: { doc: GeneratedDoc; size: "compact-xs" | "sm"; opened?: boolean; onClose?: () => void }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = opened !== undefined;
  const open = controlled ? opened : ownOpen;
  const setOpen = (v: boolean) => (controlled ? !v && onClose?.() : setOwnOpen(v));
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api<{ sent_to: string }>(`/documents/${doc.id}/email`, { method: "POST", body: { to: to.trim() || null, message: message.trim() || null } }),
    onSuccess: (r) => {
      notifications.show({ color: "green", message: `Wysłano na ${r.sent_to}.` });
      setOpen(false);
    },
  });
  return (
    <>
      {!controlled && (
        <Button size={size} variant="default" leftSection={<IconMail size={14} />} onClick={() => { setTo(""); setMessage(""); setOpen(true); }}>
          E-mail
        </Button>
      )}
      <FormDialog opened={open} onClose={() => setOpen(false)} title="Wyślij dokument e-mailem" size="md" primary={{ label: "Wyślij", onClick: () => send.mutate(), loading: send.isPending }}>
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
        </Stack>
      </FormDialog>
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
    <Group gap={4} wrap="wrap">
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

function DeleteDocument({ doc, employee, opened, onClose }: { doc: GeneratedDoc; employee: Employee; opened?: boolean; onClose?: () => void }) {
  const qc = useQueryClient();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = opened !== undefined;
  const open = controlled ? opened : ownOpen;
  const setOpen = (v: boolean) => (controlled ? !v && onClose?.() : setOwnOpen(v));
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
  });
  if (!doc.can_delete) return null;
  return (
    <>
      {!controlled && (
        <Tooltip label="Usuń dokument">
          <ActionIcon variant="subtle" color="red" size="sm" aria-label="Usuń dokument" onClick={() => { setReason(""); setOpen(true); }}>
            <IconTrash size={15} />
          </ActionIcon>
        </Tooltip>
      )}
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
  });
  if (!trash.data?.length) return null;
  return (
    <Stack gap={8}>
      <Anchor component="button" type="button" size="sm" c="dimmed" w="fit-content" onClick={() => setShow(!show)} aria-expanded={show}>
        {show ? "Ukryj usunięte" : `Usunięte dokumenty (${trash.data.length})`}
      </Anchor>
      {show && (
        <div className="ui-dlist">
          {trash.data.map((t) => (
            <div key={t.id} className="ui-drow">
              <div style={{ minWidth: 0 }}>
                <div className="ui-drow-title" style={{ color: "var(--mantine-color-dimmed)" }}>
                  {t.template_name}
                </div>
                <div className="ui-drow-meta">
                  Usunięto {formatDateTime(t.deleted_at)}
                  {t.deleted_by_name ? ` · ${t.deleted_by_name}` : ""}
                  {t.delete_reason ? ` · ${t.delete_reason}` : ""} · zniknie na stałe {formatDateTime(t.purge_at)}
                </div>
              </div>
              {t.can_restore && (
                <Button size="xs" variant="default" loading={restore.isPending && restore.variables === t.id} onClick={() => restore.mutate(t.id)}>
                  Przywróć
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Stack>
  );
}

/**
 * Pola „Adres zamieszkania – miasto”, „Adres zamieszkania – ulica”… pod wspólnym nagłówkiem „Adres zamieszkania”,
 * a w polu sama końcówka („Miasto”). Grupa liczy się od 2 kolejnych pól z tym samym początkiem.
 */
function grouped(fields: TemplateField[]): { f: TemplateField; head?: string }[] {
  const pre = (f: TemplateField) => (f.label.includes(" – ") ? f.label.split(" – ")[0] : null);
  return fields.map((f, i) => {
    const p = pre(f);
    const inGroup = p !== null && ((i > 0 && pre(fields[i - 1]) === p) || (i + 1 < fields.length && pre(fields[i + 1]) === p));
    if (!inGroup) return { f };
    const rest = f.label.slice(p!.length + 3);
    const first = i === 0 || pre(fields[i - 1]) !== p;
    return { f: { ...f, label: rest.charAt(0).toUpperCase() + rest.slice(1) }, head: first ? p! : undefined };
  });
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
  const [moreFields, setMoreFields] = useState(false);
  const [sheetDoc, setSheetDoc] = useState<GeneratedDoc | null>(null);
  const [viewDoc, setViewDoc] = useState<GeneratedDoc | null>(null);
  const [mailDoc, setMailDoc] = useState<GeneratedDoc | null>(null);
  const [delDoc, setDelDoc] = useState<GeneratedDoc | null>(null);
  const remind = useRemindSignature();
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
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

  const generateModal = (
    <>
      <FormDialog opened={open} onClose={() => setOpen(false)} title={done ? "Dokument gotowy" : "Nowy dokument"} size="lg" cancel={done ? false : "Anuluj"} primary={done ? { label: "Gotowe", onClick: () => setOpen(false) } : { label: "Generuj dokument", formId: "fd-newdoc", loading: generate.isPending, disabled: !template || missing.length > 0 || !!peselError || formatErrors.length > 0 }}>
        {done ? (
          <Stack>
            <Group gap="sm" wrap="nowrap">
              <IconCircleCheck size={32} color="var(--mantine-color-green-text)" />
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
              </Group>
            </Group>
          </Stack>
        ) : (
        <form id="fd-newdoc"
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
            {template && template.fields.some((f) => !f.collapsed || f.required) && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {grouped(template.fields.filter((f) => !f.collapsed || f.required)).map(({ f, head }) => (
                  <Fragment key={f.key}>
                    {head && <Text className="ui-field-group">{head}</Text>}
                    <FieldInput field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                  </Fragment>
                ))}
              </SimpleGrid>
            )}
            {template && template.fields.some((f) => f.collapsed && !f.required) && (
              <>
                <Button
                  variant="subtle"
                  size="sm"
                  w="fit-content"
                  px={4}
                  leftSection={moreFields ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  onClick={() => setMoreFields((v) => !v)}
                  aria-expanded={moreFields}
                >
                  {moreFields ? "Ukryj dodatkowe pola" : `Więcej pól (${template.fields.filter((f) => f.collapsed && !f.required).length})`}
                </Button>
                <Collapse in={moreFields}>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    {grouped(template.fields.filter((f) => f.collapsed && !f.required)).map(({ f, head }) => (
                      <Fragment key={f.key}>
                        {head && <Text className="ui-field-group">{head}</Text>}
                        <FieldInput field={f} value={values[f.key] ?? null} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                      </Fragment>
                    ))}
                  </SimpleGrid>
                </Collapse>
              </>
            )}
            {warnMasked && (
              <Alert color="blue" variant="light">
                Ten szablon zawiera PESEL lub datę urodzenia – w Twoim dokumencie te pola zostaną puste.
              </Alert>
            )}
          </Stack>
        </form>
        )}
      </FormDialog>
    </>
  );
  const openGenerate = () => {
    setTemplateId(templates.data?.length === 1 ? String(templates.data[0].id) : null);
    setValues({});
    setDone(null);
    setOpen(true);
  };

  if (mobile) {
    const d = sheetDoc;
    const actions: SheetAction[] = [];
    if (d && d.accessible) {
      actions.push({ label: d.signed_at ? "Podpisy" : "Podpisz lub poproś o podpis", icon: <IconSignature size={20} />, onClick: () => setSignDoc(d) });
      if (d.signature_pending) actions.push({ label: "Przypomnij o podpisie", icon: <IconBell size={20} />, onClick: () => remind.mutate(d) });
      if (d.can_view) actions.push({ label: "Podgląd dokumentu", icon: <IconEye size={20} />, onClick: () => setViewDoc(d) });
      if (d.download.includes("pdf")) actions.push({ label: "Pobierz PDF", icon: <IconFileTypePdf size={20} />, onClick: () => download(d, "pdf") });
      if (d.download.includes("docx")) actions.push({ label: "Pobierz Word", icon: <IconFileTypeDocx size={20} />, onClick: () => download(d, "docx") });
      if (d.download.length > 0) actions.push({ label: "Wyślij e-mailem", icon: <IconMail size={20} />, onClick: () => setMailDoc(d) });
    }
    if (d?.can_delete) actions.push({ label: "Usuń dokument", description: "Trafi do kosza na 30 dni.", icon: <IconTrash size={20} />, danger: true, onClick: () => setDelDoc(d) });
    return (
      <>
        <Section
          title="Dokumenty"
          action={templates.data?.length ? { label: "Generuj", icon: <IconPlus size={16} />, onClick: openGenerate } : undefined}
        >
          {docs.isLoading && <Loading rows={2} />}
          {docs.data?.map((doc) => (
            <ListRow
              key={doc.id}
              leading={<IconFileText size={20} />}
              title={doc.template_name}
              description={
                <>
                  {doc.signed_at ? <StatusBadge tone="ok">podpisany</StatusBadge> : doc.signature_pending ? <StatusBadge tone="wait">czeka na podpis</StatusBadge> : null}
                  {doc.signed_at || doc.signature_pending ? " " : ""}
                  {formatDateTime(doc.created_at)}
                </>
              }
              onClick={() => setSheetDoc(doc)}
            />
          ))}
          {docs.data?.length === 0 && (
            <CompactEmpty
              title={templates.data?.length === 0 ? "Brak szablonów" : "Brak dokumentów"}
              text={templates.data?.length === 0 ? "Administrator dodaje je w „Szablonach”." : undefined}
            />
          )}
        </Section>
        <TrashList employee={employee} />
        <ActionSheet
          opened={!!sheetDoc}
          onClose={() => setSheetDoc(null)}
          title={d?.template_name ?? ""}
          subtitle={d ? `${formatDateTime(d.created_at)} · ${d.created_by_name ?? "—"}` : undefined}
          actions={actions}
        />
        {viewDoc && <DocumentViewer docId={viewDoc.id} opened onClose={() => setViewDoc(null)} />}
        {mailDoc && <EmailDocument doc={mailDoc} size="sm" opened onClose={() => setMailDoc(null)} />}
        {delDoc && <DeleteDocument doc={delDoc} employee={employee} opened onClose={() => setDelDoc(null)} />}
        {generateModal}
        {signDoc && <SignaturesModal doc={signDoc} employee={employee} opened onClose={() => setSignDoc(null)} />}
      </>
    );
  }

  // komputer: sekcja na tle, ramka tylko wokół listy; w wierszu status, „Podgląd” i „⋯” (reszta akcji w menu)
  return (
    <section className="ui-dsec">
      <div className="ui-dsec-head">
        <Title order={2} className="ui-dsec-title">
          Dokumenty
        </Title>
        <Anchor component="button" id="nowy-dokument" fw={600} size="sm" onClick={openGenerate} disabled={!templates.data?.length}>
          Nowy dokument
        </Anchor>
      </div>
      {templates.data && templates.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Brak dostępnych szablonów. Administrator dodaje je w „Szablonach”.
        </Text>
      )}
      {docs.isLoading && <Loading />}
      {docs.data && docs.data.length === 0 && templates.data?.length !== 0 && (
        <Text size="sm" c="dimmed">
          Nie ma jeszcze dokumentów – „Nowy dokument” wygeneruje go z szablonu.
        </Text>
      )}
      {docs.data && docs.data.length > 0 && (
        <div className="ui-dlist">
          {docs.data.map((d) => (
            <div key={d.id} id={`dok-${d.id}`} className="ui-drow">
              <div style={{ minWidth: 0 }}>
                <div className="ui-drow-title">{d.template_name}</div>
                <div className="ui-drow-meta">
                  {formatDateTime(d.created_at)} · {d.created_by_name ?? "—"}
                  {d.masked && " · bez PESEL i daty urodzenia"}
                </div>
              </div>
              <Group gap={8} wrap="nowrap" style={{ flex: "none" }}>
                {d.signed_at ? (
                  <Text size="sm">Podpisany {formatDateTime(d.signed_at)}</Text>
                ) : d.signature_pending ? (
                  <Text size="sm" className="ui-warn">
                    Czeka na podpis
                  </Text>
                ) : null}
                {!d.accessible ? (
                  <Text size="sm" c="dimmed">
                    zawiera dane wrażliwe
                  </Text>
                ) : (
                  d.can_view && (
                    <Button size="xs" variant="default" onClick={() => setViewDoc(d)}>
                      Podgląd
                    </Button>
                  )
                )}
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="default" size={30} aria-label={`Więcej: ${d.template_name}`}>
                      <IconDots size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {d.accessible && (
                      <Menu.Item leftSection={<IconSignature size={16} />} onClick={() => setSignDoc(d)}>
                        {d.signed_at ? "Podpisy" : "Podpisz lub poproś o podpis"}
                      </Menu.Item>
                    )}
                    {d.signature_pending && (
                      <Menu.Item leftSection={<IconBell size={16} />} onClick={() => remind.mutate(d)}>
                        Przypomnij o podpisie
                      </Menu.Item>
                    )}
                    {d.accessible && d.download.includes("pdf") && (
                      <Menu.Item leftSection={<IconFileTypePdf size={16} />} onClick={() => download(d, "pdf")}>
                        Pobierz PDF
                      </Menu.Item>
                    )}
                    {d.accessible && d.download.includes("docx") && (
                      <Menu.Item leftSection={<IconFileTypeDocx size={16} />} onClick={() => download(d, "docx")}>
                        Pobierz Word
                      </Menu.Item>
                    )}
                    {d.accessible && d.download.length > 0 && (
                      <Menu.Item leftSection={<IconMail size={16} />} onClick={() => setMailDoc(d)}>
                        Wyślij e-mailem
                      </Menu.Item>
                    )}
                    {d.can_delete && (
                      <>
                        <Menu.Divider />
                        <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setDelDoc(d)}>
                          Usuń dokument
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </div>
          ))}
        </div>
      )}
      <TrashList employee={employee} />
      {viewDoc && <DocumentViewer docId={viewDoc.id} opened onClose={() => setViewDoc(null)} />}
      {mailDoc && <EmailDocument doc={mailDoc} size="sm" opened onClose={() => setMailDoc(null)} />}
      {delDoc && <DeleteDocument doc={delDoc} employee={employee} opened onClose={() => setDelDoc(null)} />}
      {generateModal}
      {signDoc && <SignaturesModal doc={signDoc} employee={employee} opened onClose={() => setSignDoc(null)} />}
    </section>
  );
}
