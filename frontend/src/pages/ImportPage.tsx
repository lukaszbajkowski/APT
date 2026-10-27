import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Group,
  List,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconCheck, IconDownload, IconFileSpreadsheet, IconUpload } from "@tabler/icons-react";

import { api, errorText, formatDate, withAcct } from "../api";

interface FieldDef {
  key: string;
  label: string;
}

interface Analysis {
  file_name: string;
  sheet: string | null;
  headers: string[];
  sample: (string | null)[][];
  total_rows: number;
  mapping: Record<string, number>;
}

interface PreviewRow {
  row: number;
  status: "ok" | "skip" | "error";
  errors: string[];
  warnings: string[];
  name: string | null;
  pesel_masked: string | null;
  birth_date: string | null;
  country: string | null;
  agency: string | null;
  department: string | null;
  position: string | null;
  hire_date: string | null;
}

interface Preview {
  summary: {
    total: number;
    to_import: number;
    skipped: number;
    errors: number;
    new_dictionary_items: Record<string, string[]>;
  };
  rows: PreviewRow[];
}

interface CommitResult {
  imported: number;
  skipped: number;
  errors: number;
  first_number: string | null;
  last_number: string | null;
}

const DICT_LABELS: Record<string, string> = { agencies: "APT", departments: "Wydziały", positions: "Stanowiska" };
const STATUS: Record<PreviewRow["status"], { color: string; label: string }> = {
  ok: { color: "green", label: "do importu" },
  skip: { color: "yellow", label: "pominięty" },
  error: { color: "red", label: "błąd" },
};

function colLetter(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function ImportPage() {
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["import-fields"], queryFn: () => api<FieldDef[]>("/import/fields") });

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [createMissing, setCreateMissing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [filter, setFilter] = useState("all");
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.append("file", file!);
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== null));
    f.append("mapping", JSON.stringify(clean));
    f.append("create_missing", String(createMissing));
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  };

  const analyze = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api<Analysis>("/import/analyze", { method: "POST", form: fd });
    },
    onSuccess: (a) => {
      setAnalysis(a);
      setMapping(a.mapping);
      setPreview(null);
      setStep(1);
    },
    onError: (e) => setError(errorText(e)),
  });

  const check = useMutation({
    mutationFn: () => api<Preview>("/import/preview", { method: "POST", form: form() }),
    onSuccess: (p) => {
      setPreview(p);
      setSkipErrors(false);
      setFilter(p.summary.errors ? "error" : "all");
      setStep(2);
    },
    onError: (e) => setError(errorText(e)),
  });

  const commit = useMutation({
    mutationFn: () =>
      api<CommitResult>("/import/commit", { method: "POST", form: form({ skip_errors: String(skipErrors) }) }),
    onSuccess: (r) => {
      setResult(r);
      setStep(3);
      qc.invalidateQueries({ queryKey: ["employees"] });
      ["agencies", "departments", "positions"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => setError(errorText(e)),
  });

  function reset() {
    setStep(0);
    setFile(null);
    setAnalysis(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setCreateMissing(false);
  }

  const columnOptions = useMemo(
    () =>
      (analysis?.headers ?? []).map((h, i) => {
        const example = analysis?.sample.find((r) => r[i])?.[i];
        return {
          value: String(i),
          label: `${colLetter(i)}: ${h}${example ? ` (np. ${example.slice(0, 24)})` : ""}`,
        };
      }),
    [analysis],
  );
  const usedColumns = new Set(Object.values(mapping).filter((v) => v !== null));
  const hasNames =
    (mapping.last_name != null && mapping.first_name != null) || mapping.full_name != null;

  const rows = (preview?.rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const canImport = preview && preview.summary.to_import > 0 && (preview.summary.errors === 0 || skipErrors);

  return (
    <Stack maw={1200}>
      <div>
        <Anchor component={Link} to="/pracownicy" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} /> Wróć do listy pracowników
          </Group>
        </Anchor>
        <Title order={2} mt={4}>Import pracowników</Title>
        <Text c="dimmed" size="sm">
          Wczytaj listę z Excela (.xlsx), Numbers na Macu (.numbers) lub CSV. Przed zapisem zobaczysz, co zostanie dodane, a co wymaga poprawy.
        </Text>
      </div>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stepper active={step} size="sm" allowNextStepsSelect={false} onStepClick={(s) => s < step && step < 3 && setStep(s)}>
        {/* ---------- 1. plik ---------- */}
        <Stepper.Step label="Plik" description="xlsx, numbers, csv">
          <Paper withBorder p="xl" mt="md">
            <Stack align="center" gap="md">
              <IconFileSpreadsheet size={48} stroke={1.3} color="var(--mantine-color-navy-6)" />
              <Text ta="center">
                Pierwszy wiersz z nazwami kolumn zostanie rozpoznany automatycznie.
                <br />
                Puste wiersze i tytuły nad tabelą są pomijane.
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Obsługiwane: Excel (.xlsx), Numbers (.numbers), CSV. Szablon otworzysz w Excelu i w Numbers.
              </Text>
              <Group>
                <FileButton
                  accept=".xlsx,.numbers,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers"
                  onChange={(f) => {
                    setError(null);
                    setFile(f);
                    if (f) analyze.mutate(f);
                  }}
                >
                  {(props) => (
                    <Button {...props} leftSection={<IconUpload size={16} />} loading={analyze.isPending}>
                      Wybierz plik
                    </Button>
                  )}
                </FileButton>
                <Button
                  variant="default"
                  component="a"
                  href={withAcct("/api/import/template")}
                  download
                  leftSection={<IconDownload size={16} />}
                >
                  Pobierz szablon .xlsx
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Stepper.Step>

        {/* ---------- 2. kolumny ---------- */}
        <Stepper.Step label="Kolumny" description="co jest gdzie">
          {analysis && (
            <Stack mt="md">
              <Text size="sm">
                Plik <b>{analysis.file_name}</b>
                {analysis.sheet ? `, arkusz „${analysis.sheet}”` : ""} – wierszy z danymi: <b>{analysis.total_rows}</b>.
                Sprawdź, czy kolumny są przypisane dobrze. Pola bez kolumny zostaną puste.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                {(fields.data ?? []).map((f) => (
                  <Select
                    key={f.key}
                    label={f.label}
                    placeholder="— nie importuj —"
                    clearable
                    data={columnOptions.map((o) => ({
                      ...o,
                      disabled: usedColumns.has(Number(o.value)) && mapping[f.key] !== Number(o.value),
                    }))}
                    value={mapping[f.key] != null ? String(mapping[f.key]) : null}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === null ? null : Number(v) }))}
                  />
                ))}
              </SimpleGrid>
              {!hasNames && (
                <Alert color="orange">
                  Przypisz kolumnę z nazwiskiem i imieniem – osobno albo „Nazwisko i imię” w jednej kolumnie.
                </Alert>
              )}

              <Text fw={600} size="sm" mt="xs">
                Pierwsze wiersze pliku
              </Text>
              <Table.ScrollContainer minWidth={700}>
                <Table withTableBorder withColumnBorders fz="xs" striped>
                  <Table.Thead>
                    <Table.Tr>
                      {analysis.headers.map((h, i) => (
                        <Table.Th key={i}>
                          {colLetter(i)}: {h}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {analysis.sample.map((r, ri) => (
                      <Table.Tr key={ri}>
                        {analysis.headers.map((_, ci) => (
                          <Table.Td key={ci}>{r[ci] ?? ""}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>

              <Checkbox
                label="Dodaj do słowników APT, wydziały i stanowiska, których jeszcze nie ma"
                description="Bez zaznaczenia nieznane nazwy będą oznaczone jako błąd."
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.currentTarget.checked)}
              />
              <Group justify="space-between">
                <Button variant="default" onClick={reset}>
                  Inny plik
                </Button>
                <Button onClick={() => check.mutate()} loading={check.isPending} disabled={!hasNames}>
                  Sprawdź dane
                </Button>
              </Group>
            </Stack>
          )}
        </Stepper.Step>

        {/* ---------- 3. podgląd ---------- */}
        <Stepper.Step label="Sprawdzenie" description="podgląd i zapis">
          {preview && (
            <Stack mt="md">
              <SimpleGrid cols={{ base: 1, xs: 3 }}>
                <Card withBorder>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Do importu
                  </Text>
                  <Text fz={32} fw={700} c="green.8">
                    {preview.summary.to_import}
                  </Text>
                </Card>
                <Card withBorder>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Pominięte (już są w kartotece)
                  </Text>
                  <Text fz={32} fw={700} c="yellow.9">
                    {preview.summary.skipped}
                  </Text>
                </Card>
                <Card withBorder>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Z błędami
                  </Text>
                  <Text fz={32} fw={700} c={preview.summary.errors ? "red.8" : "dimmed"}>
                    {preview.summary.errors}
                  </Text>
                </Card>
              </SimpleGrid>

              {Object.keys(preview.summary.new_dictionary_items).length > 0 && (
                <Alert color="blue" title="Do słowników zostaną dodane">
                  <List size="sm">
                    {Object.entries(preview.summary.new_dictionary_items).map(([k, items]) => (
                      <List.Item key={k}>
                        {DICT_LABELS[k] ?? k}: {items.join(", ")}
                      </List.Item>
                    ))}
                  </List>
                </Alert>
              )}

              <Group justify="space-between">
                <SegmentedControl
                  value={filter}
                  onChange={setFilter}
                  data={[
                    { value: "all", label: `Wszystkie (${preview.summary.total})` },
                    { value: "error", label: `Błędy (${preview.summary.errors})` },
                    { value: "skip", label: `Pominięte (${preview.summary.skipped})` },
                    { value: "ok", label: `Do importu (${preview.summary.to_import})` },
                  ]}
                />
              </Group>

              <Table.ScrollContainer minWidth={900}>
                <Table striped fz="sm" verticalSpacing={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Wiersz</Table.Th>
                      <Table.Th>Osoba</Table.Th>
                      <Table.Th>PESEL</Table.Th>
                      <Table.Th>Ur.</Table.Th>
                      <Table.Th>APT</Table.Th>
                      <Table.Th>Wydział / stanowisko</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.slice(0, 500).map((r) => (
                      <Table.Tr key={r.row}>
                        <Table.Td ff="monospace">{r.row}</Table.Td>
                        <Table.Td>{r.name ?? <Text c="dimmed">—</Text>}</Table.Td>
                        <Table.Td ff="monospace">{r.pesel_masked ?? "—"}</Table.Td>
                        <Table.Td>{formatDate(r.birth_date)}</Table.Td>
                        <Table.Td>{r.agency ?? "—"}</Table.Td>
                        <Table.Td>
                          {r.department ?? "—"}
                          {r.position ? ` / ${r.position}` : ""}
                        </Table.Td>
                        <Table.Td maw={340}>
                          <Badge color={STATUS[r.status].color} variant="light">
                            {STATUS[r.status].label}
                          </Badge>
                          {[...r.errors, ...r.warnings].map((m, i) => (
                            <Text key={i} size="xs" c={r.errors.includes(m) ? "red.8" : "dimmed"}>
                              {m}
                            </Text>
                          ))}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {rows.length > 500 && (
                <Text size="sm" c="dimmed">
                  Pokazano 500 z {rows.length} wierszy.
                </Text>
              )}

              {preview.summary.errors > 0 && (
                <Checkbox
                  label={`Pomiń ${preview.summary.errors} wierszy z błędami i zaimportuj pozostałe`}
                  description="Albo popraw plik i wczytaj go ponownie."
                  checked={skipErrors}
                  onChange={(e) => setSkipErrors(e.currentTarget.checked)}
                />
              )}
              <Group justify="space-between">
                <Button variant="default" onClick={() => setStep(1)}>
                  Wróć do kolumn
                </Button>
                <Button
                  color="green"
                  leftSection={<IconCheck size={16} />}
                  disabled={!canImport}
                  loading={commit.isPending}
                  onClick={() => commit.mutate()}
                >
                  Importuj {preview.summary.to_import} {preview.summary.to_import === 1 ? "osobę" : "osób"}
                </Button>
              </Group>
            </Stack>
          )}
        </Stepper.Step>

        {/* ---------- 4. gotowe ---------- */}
        <Stepper.Completed>
          {result && (
            <Paper withBorder p="xl" mt="md">
              <Stack align="center">
                <IconCheck size={48} color="var(--mantine-color-green-7)" />
                <Title order={3}>Zaimportowano {result.imported} pracowników</Title>
                {result.first_number && (
                  <Text>
                    Nadane numery ewidencyjne: {result.first_number}
                    {result.last_number !== result.first_number ? ` – ${result.last_number}` : ""}
                  </Text>
                )}
                {(result.skipped > 0 || result.errors > 0) && (
                  <Text c="dimmed" size="sm">
                    Pominięto: {result.skipped} (już w kartotece), z błędami: {result.errors}.
                  </Text>
                )}
                <Group>
                  <Button component={Link} to="/pracownicy">
                    Przejdź do listy pracowników
                  </Button>
                  <Button variant="default" onClick={reset}>
                    Importuj kolejny plik
                  </Button>
                </Group>
                <Anchor component={Link} to="/pracownicy?missing=photo" size="sm">
                  Pokaż osoby bez zdjęcia
                </Anchor>
              </Stack>
            </Paper>
          )}
        </Stepper.Completed>
      </Stepper>
    </Stack>
  );
}
