import { useMemo, useState } from "react";
import { ImportMobile } from "../components/ImportMobile";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Paper, SegmentedControl, SimpleGrid, Stack, Stepper, Table, Text, Title } from "@mantine/core";
import { Select } from "../components/AptSelect";
import { IconArrowLeft, IconCheck, IconDownload, IconFileSpreadsheet, IconUpload } from "@tabler/icons-react";

import { api, errorText, withAcct } from "../api";
import { PageTitle } from "../components/Mobile";
import { useIsPhone } from "../lib/device";

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
  employee: string | null;
  training: string | null;
  dates: string | null;
}

interface Preview {
  summary: { total: number; to_import: number; skipped: number; errors: number };
  rows: PreviewRow[];
}

interface CommitResult {
  imported: number;
  skipped: number;
  errors: number;
}

const STATUS: Record<PreviewRow["status"], { color: string; label: string }> = {
  ok: { color: "green", label: "Do importu" },
  skip: { color: "yellow", label: "Pominięty" },
  error: { color: "red", label: "Błąd" },
};

function colLetter(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function TrainingImportPage() {
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["training-import-fields"], queryFn: () => api<FieldDef[]>("/trainings/import/fields") });

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
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
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  };

  const analyze = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api<Analysis>("/trainings/import/analyze", { method: "POST", form: fd });
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
    mutationFn: () => api<Preview>("/trainings/import/preview", { method: "POST", form: form() }),
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
      api<CommitResult>("/trainings/import/commit", { method: "POST", form: form({ skip_errors: String(skipErrors) }) }),
    onSuccess: (r) => {
      setResult(r);
      setStep(3);
      ["trainings", "trainings-expiring", "trainings-in-progress", "trainings-report"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
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
    mapping.number != null ||
    mapping.pesel != null ||
    mapping.full_name != null ||
    (mapping.last_name != null && mapping.first_name != null);
  const hasType = mapping.type != null || mapping.name != null;

  const rows = (preview?.rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const canImport = preview && preview.summary.to_import > 0 && (preview.summary.errors === 0 || skipErrors);

  const mobile = useIsPhone();
  if (mobile) {
    const n = preview?.summary.to_import ?? 0;
    return (
      <ImportMobile
        title="Import szkoleń"
        backTo="/szkolenia"
        intro="Jeden wiersz to jedno szkolenie jednej osoby. Przed zapisem zobaczysz, co zostanie dodane."
        howTo="Pierwszy wiersz z nazwami kolumn zostanie rozpoznany automatycznie, a puste wiersze i tytuły nad tabelą są pomijane. Osobę wskaż numerem, PESEL-em albo nazwiskiem i imieniem. Rodzaj szkolenia musi istnieć w „Rodzajach szkoleń”. Daty wpisz jako dd.mm.rrrr."
        templateHref={withAcct("/api/trainings/import/template")}
        step={step}
        setStep={setStep}
        error={error}
        clearError={() => setError(null)}
        onFile={(f) => {
          setError(null);
          setFile(f);
          analyze.mutate(f);
        }}
        analyzing={analyze.isPending}
        fileName={analysis?.file_name ?? file?.name}
        fileInfo={analysis ? `${analysis.sheet ? `Arkusz „${analysis.sheet}” · ` : ""}${analysis.total_rows} wierszy` : undefined}
        fields={fields.data ?? []}
        headers={analysis?.headers ?? []}
        sample={analysis?.sample ?? []}
        mapping={mapping}
        setMapping={(k, v) => setMapping((m) => ({ ...m, [k]: v }))}
        required={[...(hasNames ? [] : ["number", "pesel", "full_name"]), ...(hasType ? [] : ["type", "name"])]}
        mappingHint={!hasNames ? "Przypisz kolumnę, po której rozpoznamy osobę: numer, PESEL albo nazwisko i imię." : !hasType ? "Przypisz kolumnę z rodzajem szkolenia (albo nazwą z katalogu)." : null}
        onCheck={() => check.mutate()}
        checking={check.isPending}
        summary={preview?.summary}
        rows={(preview?.rows ?? []).map((r) => ({ row: r.row, status: r.status, title: [r.employee, r.training].filter(Boolean).join(" · "), errors: r.errors, warnings: r.warnings }))}
        skipErrors={skipErrors}
        setSkipErrors={setSkipErrors}
        onCommit={() => commit.mutate()}
        committing={commit.isPending}
        commitLabel={`Zapisz ${n} ${n === 1 ? "szkolenie" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "szkolenia" : "szkoleń"}`}
        done={
          result && (
            <Stack align="center" gap="md" py="xl">
              <IconCheck size={48} color="var(--mantine-color-teal-text)" />
              <Title order={3} ta="center">Zaimportowano szkoleń: {result.imported}</Title>
              {(result.skipped > 0 || result.errors > 0) && <Text c="dimmed" size="sm" ta="center">Pominięto: {result.skipped}, z błędami: {result.errors}.</Text>}
              <Button size="lg" radius="md" fullWidth component={Link} to="/szkolenia">Wróć do szkoleń</Button>
              <Button size="lg" radius="md" fullWidth variant="default" onClick={reset}>Importuj kolejny plik</Button>
            </Stack>
          )
        }
        onReset={reset}
      />
    );
  }

  return (
    <Stack maw={1200}>
      <div>
        <Anchor component={Link} to="/szkolenia" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={14} /> Wróć do szkoleń
          </Group>
        </Anchor>
        <div style={{ marginTop: 8 }}>
          <PageTitle title="Import szkoleń" description={<>Wczytaj historię szkoleń z Excela (.xlsx), Numbers (.numbers) lub CSV – jeden wiersz to jedno szkolenie jednej osoby.
          Przed zapisem zobaczysz, co zostanie dodane, a co wymaga poprawy.</>} />
        </div>
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
              <IconFileSpreadsheet size={48} stroke={1.3} color="var(--mantine-primary-color-filled)" />
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
                  href={withAcct("/api/trainings/import/template")}
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
                  Przypisz kolumnę, po której rozpoznamy pracownika: nr ewidencyjny, PESEL albo nazwisko i imię.
                </Alert>
              )}
              {!hasType && <Alert color="orange">Przypisz kolumnę z rodzajem szkolenia (albo nazwą z katalogu).</Alert>}

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

              <Group justify="space-between">
                <Button variant="default" onClick={reset}>
                  Inny plik
                </Button>
                <Button onClick={() => check.mutate()} loading={check.isPending} disabled={!hasNames || !hasType}>
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
                  <Text size="xs" c="dimmed" fw={600}>
                    Do importu
                  </Text>
                  <Text fz={32} fw={700} c="green">
                    {preview.summary.to_import}
                  </Text>
                </Card>
                <Card withBorder>
                  <Text size="xs" c="dimmed" fw={600}>
                    Pominięte (już są lub powtórzone)
                  </Text>
                  <Text fz={32} fw={700} c="yellow">
                    {preview.summary.skipped}
                  </Text>
                </Card>
                <Card withBorder>
                  <Text size="xs" c="dimmed" fw={600}>
                    Z błędami
                  </Text>
                  <Text fz={32} fw={700} c={preview.summary.errors ? "red.8" : "dimmed"}>
                    {preview.summary.errors}
                  </Text>
                </Card>
              </SimpleGrid>

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

              <Table.ScrollContainer minWidth={760}>
                <Table striped fz="sm" verticalSpacing={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Wiersz</Table.Th>
                      <Table.Th>Pracownik</Table.Th>
                      <Table.Th>Szkolenie</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.slice(0, 500).map((r) => (
                      <Table.Tr key={r.row}>
                        <Table.Td ff="monospace">{r.row}</Table.Td>
                        <Table.Td>{r.employee ?? <Text c="dimmed">—</Text>}</Table.Td>
                        <Table.Td>
                          {r.training ?? "—"}
                          {r.dates && (
                            <Text size="xs" c="dimmed">
                              {r.dates}
                            </Text>
                          )}
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
                  Importuj {preview.summary.to_import} {preview.summary.to_import === 1 ? "szkolenie" : "szkoleń"}
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
                <IconCheck size={48} color="var(--mantine-color-green-text)" />
                <Title order={3}>Zaimportowano szkoleń: {result.imported}</Title>
                {(result.skipped > 0 || result.errors > 0) && (
                  <Text c="dimmed" size="sm">
                    Pominięto: {result.skipped} (już w kartotece lub powtórzone), z błędami: {result.errors}.
                  </Text>
                )}
                <Group>
                  <Button component={Link} to="/szkolenia">
                    Przejdź do szkoleń
                  </Button>
                  <Button variant="default" onClick={reset}>
                    Importuj kolejny plik
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </Stepper.Completed>
      </Stepper>
    </Stack>
  );
}
