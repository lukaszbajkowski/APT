import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Checkbox, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconArrowRight, IconFileZip } from "@tabler/icons-react";

import { api, apiDownload, errorText, LANGUAGES, type DocTemplate, type Employee } from "../api";
import { useAuth } from "../auth";
import { FieldInput, useFieldFormats, type Values } from "./DocumentsCard";
import { fieldProblem, peselProblem } from "../masks";
import { Loading } from "./States";

const MAX = 50;

function missingRequired(t: DocTemplate, v: Values) {
  return t.fields.filter((f) => f.required && (v[f.key] === undefined || v[f.key] === "" || v[f.key] === null));
}

export function BatchDocumentsModal({ ids, opened, onClose }: { ids: number[]; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const templates = useQuery({
    queryKey: ["templates", "active"],
    queryFn: () => api<DocTemplate[]>("/templates?active_only=true"),
    enabled: opened,
  });
  const people = useQuery({
    queryKey: ["batch-people", ids],
    queryFn: () => Promise.all(ids.map((id) => api<Employee>(`/employees/${id}`))),
    enabled: opened && ids.length <= MAX,
  });

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [same, setSame] = useState(true);
  const [step, setStep] = useState(0); // 0 = wybór szablonu, 1..n = osoby (albo 1 = wspólne wartości)
  const [values, setValues] = useState<Values[]>([]);
  const [busy, setBusy] = useState(false);
  const [peselBy, setPeselBy] = useState<Record<number, string>>({});
  const formatsQ = useFieldFormats();
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(() => templates.data?.find((t) => String(t.id) === templateId), [templates.data, templateId]);
  const formats = template ? (template.download_formats === "both" ? ["pdf", "docx"] : [template.download_formats]) : ["pdf"];
  const list = people.data ?? [];

  useEffect(() => {
    if (opened) {
      setStep(0);
      setError(null);
      setValues([]);
      setTemplateId((cur) => cur ?? (templates.data?.length === 1 ? String(templates.data[0].id) : null));
    }
  }, [opened, templates.data]);

  useEffect(() => {
    if (template && !formats.includes(format)) setFormat(formats[0] as "pdf" | "docx");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const hasFields = !!template && template.fields.length > 0;
  const steps = !hasFields ? 0 : same ? 1 : list.length;
  const current = step >= 1 ? values[step - 1] ?? {} : {};

  const needsPesel = (e: Employee) => !!template?.builtins.includes("pesel") && e.personal_data_visible && !e.has_pesel;
  const peselInvalid = list.some((e) => needsPesel(e) && peselProblem(peselBy[e.id] ?? ""));
  const formatInvalid = (v: Values) =>
    !!template && template.fields.some((f) => f.type === "text" && fieldProblem(f, String(v[f.key] ?? ""), formatsQ.data));

  function peselInput(e: Employee) {
    const v = peselBy[e.id] ?? "";
    return (
      <TextInput
        key={`pesel-${e.id}`}
        label={same || !hasFields ? `PESEL – ${e.last_name} ${e.first_name}` : "PESEL pracownika"}
        description="Brak w kartotece – wpisany numer trafi do dokumentu i zostanie zapisany w kartotece. Puste = pole w dokumencie puste."
        placeholder="11 cyfr"
        inputMode="numeric"
        maxLength={11}
        value={v}
        onChange={(ev) => {
          const val = ev.currentTarget.value.replace(/\D/g, "");
          setPeselBy((p) => ({ ...p, [e.id]: val }));
        }}
        error={v.length === 11 ? peselProblem(v) : undefined}
        styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
      />
    );
  }

  function setCurrent(key: string, v: Values[string]) {
    setValues((all) => {
      const next = [...all];
      next[step - 1] = { ...(next[step - 1] ?? {}), [key]: v };
      return next;
    });
  }

  function goNext() {
    setError(null);
    if (step >= 1 && template && missingRequired(template, current).length) {
      setError("Uzupełnij pola wymagane.");
      return;
    }
    if (step >= 1 && formatInvalid(current)) {
      setError("Popraw pola w nieprawidłowym formacie.");
      return;
    }
    if (person && needsPesel(person) && peselProblem(peselBy[person.id] ?? "")) {
      setError("Popraw numer PESEL.");
      return;
    }
    // przejście do kolejnej osoby: wartości przechodzą dalej (jak w poprzednim programie), można je zmienić
    setValues((all) => {
      const next = [...all];
      if (step >= 1 && next[step] === undefined) next[step] = { ...current };
      return next;
    });
    setStep((s) => s + 1);
  }

  async function generate() {
    if (!template) return;
    setError(null);
    if (hasFields && missingRequired(template, current).length) {
      setError("Uzupełnij pola wymagane.");
      return;
    }
    if (hasFields && formatInvalid(current)) {
      setError("Popraw pola w nieprawidłowym formacie.");
      return;
    }
    if (peselInvalid) {
      setError("Popraw numery PESEL.");
      return;
    }
    setBusy(true);
    try {
      const items = list.map((e, i) => ({
        employee_id: e.id,
        values: hasFields ? (same ? values[0] : values[i]) ?? {} : {},
        pesel: needsPesel(e) && peselBy[e.id] ? peselBy[e.id] : null,
      }));
      await apiDownload("/documents/batch", { template_id: template.id, format, items }, "dokumenty.zip");
      notifications.show({ color: "green", message: `Pobrano paczkę ZIP z dokumentami (${items.length}).` });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const lastStep = step >= steps;
  const person = !same && step >= 1 ? list[step - 1] : null;

  return (
    <Modal opened={opened} onClose={onClose} title={`Dokument dla ${ids.length} os.`} size="lg">
      {ids.length > MAX ? (
        <Alert color="orange">Naraz można wygenerować dokumenty dla najwyżej {MAX} osób. Zawęź zaznaczenie.</Alert>
      ) : templates.isLoading || people.isLoading ? (
        <Loading />
      ) : (
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          {step === 0 && (
            <>
              <Select
                label="Szablon"
                placeholder="Wybierz"
                allowDeselect={false}
                data={(templates.data ?? []).map((t) => ({
                  value: String(t.id),
                  label: `${t.name}${t.language !== "pl" ? ` (${LANGUAGES[t.language] ?? t.language})` : ""}`,
                }))}
                value={templateId}
                onChange={(v) => {
                  setTemplateId(v);
                  setValues([]);
                }}
              />
              {template && (
                <>
                  <div>
                    <Text size="sm" fw={500} mb={4}>
                      Format plików w paczce
                    </Text>
                    <SegmentedControl
                      value={format}
                      onChange={(v) => setFormat(v as "pdf" | "docx")}
                      data={formats.map((f) => ({ value: f, label: f === "pdf" ? "PDF" : "Word" }))}
                    />
                  </div>
                  {hasFields && (
                    <Checkbox
                      label="Te same wartości pól dla wszystkich osób"
                      description="Odznacz, aby wypełnić formularz osobno dla każdej osoby (wartości przechodzą na kolejną osobę i można je zmienić)."
                      checked={same}
                      onChange={(e) => setSame(e.currentTarget.checked)}
                    />
                  )}
                  {hasRole("manager") && template.sensitive && (
                    <Alert color="blue" variant="light">
                      Szablon zawiera PESEL lub datę urodzenia – w Twoich dokumentach te pola zostaną puste.
                    </Alert>
                  )}
                  <Text size="sm" c="dimmed">
                    Osoby: {list.map((e) => `${e.last_name} ${e.first_name}`).join(", ")}
                  </Text>
                  {(same || !hasFields) && list.some(needsPesel) && (
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>
                        Brakujące numery PESEL ({list.filter(needsPesel).length})
                      </Text>
                      {list.filter(needsPesel).map(peselInput)}
                    </Stack>
                  )}
                </>
              )}
            </>
          )}

          {step >= 1 && template && (
            <>
              <Group justify="space-between">
                <Text fw={600}>
                  {same ? "Wartości dla wszystkich osób" : `${person?.last_name} ${person?.first_name}`}
                </Text>
                {!same && (
                  <Badge variant="light">
                    osoba {step} z {list.length}
                  </Badge>
                )}
              </Group>
              {person && needsPesel(person) && peselInput(person)}
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {template.fields.map((f) => (
                  <FieldInput key={`${step}-${f.key}`} field={f} value={current[f.key] ?? null} onChange={(v) => setCurrent(f.key, v)} />
                ))}
              </SimpleGrid>
            </>
          )}

          <Group justify="space-between">
            {step > 0 ? (
              <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => setStep((s) => s - 1)}>
                Wstecz
              </Button>
            ) : (
              <Button variant="default" onClick={onClose}>
                Anuluj
              </Button>
            )}
            {lastStep ? (
              <Button leftSection={<IconFileZip size={16} />} onClick={generate} loading={busy} disabled={!template}>
                Generuj paczkę ZIP ({list.length})
              </Button>
            ) : (
              <Button rightSection={<IconArrowRight size={16} />} onClick={goNext} disabled={!template}>
                Dalej
              </Button>
            )}
          </Group>
          {busy && (
            <Text size="xs" c="dimmed" ta="right">
              Generowanie może potrwać kilka–kilkadziesiąt sekund.
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
