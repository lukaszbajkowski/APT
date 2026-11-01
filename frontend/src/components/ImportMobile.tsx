/* Import z arkusza na telefonie – wspólny układ dla pracowników i szkoleń (makiety „Import … krok 1–3”). */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, FileButton, Switch, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconChevronLeft, IconChevronRight, IconDownload, IconFileSpreadsheet, IconUpload } from "@tabler/icons-react";

import { CompactEmpty, GroupLabel, ListRow, PickSheet, Segments } from "./Mobile";

export interface ImportRow {
  row: number;
  status: "ok" | "skip" | "error";
  title: string;
  errors: string[];
  warnings: string[];
}

const ACCEPT = ".xlsx,.numbers,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers";

function colLetter(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function ImportMobile(p: {
  title: string;
  backTo: string;
  intro: string;
  howTo: string;
  templateHref: string;
  step: number;
  setStep: (s: number) => void;
  error: string | null;
  clearError: () => void;
  onFile: (f: File) => void;
  analyzing: boolean;
  fileName?: string;
  fileInfo?: string;
  fields: { key: string; label: string }[];
  headers: string[];
  sample: (string | null)[][];
  mapping: Record<string, number | null>;
  setMapping: (key: string, col: number | null) => void;
  required: string[];
  mappingHint: string | null;
  onCheck: () => void;
  checking: boolean;
  summary?: { to_import: number; skipped: number; errors: number };
  rows: ImportRow[];
  extra?: ReactNode;
  skipErrors: boolean;
  setSkipErrors: (v: boolean) => void;
  onCommit: () => void;
  committing: boolean;
  commitLabel: string;
  done?: ReactNode;
  onReset: () => void;
}) {
  const navigate = useNavigate();
  const [howOpen, setHowOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [filter, setFilter] = useState("error");
  const labels = ["Plik", "Kolumny", "Sprawdzenie"];
  const back = () => (p.step === 0 || p.step === 3 ? navigate(p.backTo) : p.setStep(p.step - 1));
  const used = new Set(Object.values(p.mapping).filter((v) => v !== null));
  const example = (i: number) => p.sample.find((r) => r[i])?.[i];
  const colText = (i: number | null | undefined) => (i == null ? null : `← kolumna ${colLetter(i)} „${p.headers[i]}”`);
  const s = p.summary;
  const canCommit = !!s && s.to_import > 0 && (s.errors === 0 || p.skipErrors);
  const shown = p.rows.filter((r) => filter === "all" || r.status === filter);

  const fileButton = (label: string, big?: boolean) => (
    <FileButton accept={ACCEPT} onChange={(f) => f && p.onFile(f)}>
      {(props) =>
        big ? (
          <UnstyledButton {...props} className="ui-drop">
            <IconFileSpreadsheet size={40} stroke={1.5} color="var(--mantine-primary-color-text)" aria-hidden />
            <span className="ui-drop-title">{label}</span>
            <span className="ui-row-desc">Excel (.xlsx), Numbers lub CSV</span>
          </UnstyledButton>
        ) : (
          <Button {...props} size="lg" radius="md" fullWidth leftSection={<IconUpload size={18} />} loading={p.analyzing}>
            {label}
          </Button>
        )
      }
    </FileButton>
  );

  return (
    <div className="ui-chat">
      <header className="ui-chat-head">
        <UnstyledButton className="ui-chat-btn" onClick={back} aria-label="Wstecz">
          <IconChevronLeft size={26} stroke={2.2} />
        </UnstyledButton>
        <span className="ui-chat-title">
          <span className="ui-chat-name">{p.title}</span>
          <span className="ui-chat-sub">{p.fileName ?? "Z Excela, Numbers lub CSV"}</span>
        </span>
      </header>
      <div className="ui-form-scroll">
        {p.step < 3 && (
          <div className="ui-steps">
            <span className="ui-steps-label">
              Krok {p.step + 1} z 3 · {labels[p.step]}
            </span>
            <div className="ui-steps-bar" aria-hidden>
              {labels.map((l, i) => (
                <span key={l} data-on={i <= p.step || undefined} />
              ))}
            </div>
          </div>
        )}
        {p.error && (
          <Alert color="red" withCloseButton onClose={p.clearError}>
            {p.error}
          </Alert>
        )}

        {p.step === 0 && (
          <>
            <Text c="dimmed">{p.intro}</Text>
            {fileButton("Wybierz plik", true)}
            <div className="ui-group">
              <ListRow
                title="Pobierz szablon"
                description="Gotowe kolumny do wypełnienia"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = p.templateHref;
                  a.download = "";
                  a.click();
                }}
                trailing={<IconDownload size={20} color="var(--mantine-primary-color-text)" aria-hidden />}
              />
              <ListRow title="Jak przygotować plik" description="Nazwy kolumn, daty, numery" onClick={() => setHowOpen((x) => !x)} />
            </div>
            {howOpen && <Text size="sm" c="dimmed">{p.howTo}</Text>}
          </>
        )}

        {p.step === 1 && (
          <>
            <div className="ui-group">
              <ListRow
                leading={<IconFileSpreadsheet size={22} color="var(--mantine-primary-color-text)" aria-hidden />}
                title={p.fileName ?? ""}
                description={p.fileInfo}
                trailing={
                  <FileButton accept={ACCEPT} onChange={(f) => f && p.onFile(f)}>
                    {(props) => (
                      <Button {...props} variant="subtle" loading={p.analyzing}>
                        Zmień
                      </Button>
                    )}
                  </FileButton>
                }
              />
            </div>
            <GroupLabel>Kolumny w pliku</GroupLabel>
            <div className="ui-group">
              {p.fields.map((f) => {
                const c = colText(p.mapping[f.key]);
                const need = p.required.includes(f.key) && c === null;
                return (
                  <ListRow
                    key={f.key}
                    onClick={() => setPick(f.key)}
                    title={f.label}
                    description={
                      c ?? (
                        <span className={need ? "ui-warn-line" : undefined}>
                          {need && <IconAlertTriangle size={12} stroke={2.6} aria-hidden />} Nie importuj
                        </span>
                      )
                    }
                  />
                );
              })}
            </div>
            {p.mappingHint && <Alert color="orange">{p.mappingHint}</Alert>}
            {p.extra}
          </>
        )}

        {p.step === 2 && s && (
          <>
            <div className="ui-tiles">
              <span className="ui-tile" data-tone={s.to_import ? "ok" : "neutral"}>
                <span className="ui-tile-n" style={{ color: "var(--mantine-color-teal-text)" }}>{s.to_import}</span>
                <span className="ui-tile-l">Do dodania</span>
              </span>
              <span className="ui-tile" data-tone={s.errors ? "warn" : "neutral"}>
                <span className="ui-tile-n">{s.errors}</span>
                <span className="ui-tile-l">Do poprawy</span>
              </span>
              <span className="ui-tile">
                <span className="ui-tile-n">{s.skipped}</span>
                <span className="ui-tile-l">Pominięte</span>
              </span>
            </div>
            {p.extra}
            <Segments
              value={filter}
              onChange={setFilter}
              items={[
                { value: "error", label: `Do poprawy · ${s.errors}` },
                { value: "ok", label: "Do dodania" },
                { value: "all", label: "Wszystkie" },
              ]}
            />
            {shown.length === 0 ? (
              <CompactEmpty title={filter === "error" ? "Wszystkie wiersze są poprawne" : "Brak wierszy"} />
            ) : (
              <div className="ui-group">
                {shown.slice(0, 200).map((r) => (
                  <ListRow
                    key={r.row}
                    title={`Wiersz ${r.row}${r.title ? ` · ${r.title}` : ""}`}
                    description={
                      r.errors.length || r.warnings.length ? (
                        <>
                          {r.errors.map((m, i) => (
                            <span key={i} className="ui-warn-line">
                              <IconAlertTriangle size={12} stroke={2.6} aria-hidden /> {m}
                            </span>
                          ))}
                          {r.warnings.map((m, i) => (
                            <span key={`w${i}`} style={{ display: "block" }}>{m}</span>
                          ))}
                        </>
                      ) : r.status === "skip" ? (
                        "Już jest – pominięty"
                      ) : (
                        "Do dodania"
                      )
                    }
                    trailing={<span />}
                  />
                ))}
              </div>
            )}
            {shown.length > 200 && <Text size="sm" c="dimmed">Pokazano 200 z {shown.length} wierszy.</Text>}
            {s.errors > 0 && (
              <div className="ui-switch-row">
                <span className="ui-row-text">
                  <span className="ui-row-title">Pomiń {s.errors} wierszy z błędami</span>
                  <span className="ui-row-desc">Albo popraw plik i wczytaj go ponownie</span>
                </span>
                <Switch size="lg" aria-label="Pomiń wiersze z błędami" checked={p.skipErrors} onChange={(e) => p.setSkipErrors(e.currentTarget.checked)} />
              </div>
            )}
          </>
        )}

        {p.step === 3 && p.done}
      </div>

      {p.step < 3 && (
        <div className="ui-chat-compose">
          {p.step === 0 && fileButton("Wybierz plik")}
          {p.step > 0 && (
            <Button size="lg" radius="md" variant="default" onClick={back} style={{ flex: "none", minWidth: 110 }}>
              Wstecz
            </Button>
          )}
          {p.step === 1 && (
            <Button size="lg" radius="md" style={{ flex: 1 }} rightSection={<IconChevronRight size={18} />} loading={p.checking} disabled={!!p.mappingHint} onClick={p.onCheck}>
              Dalej – sprawdź
            </Button>
          )}
          {p.step === 2 && (
            <Button size="lg" radius="md" style={{ flex: 1 }} leftSection={<IconCheck size={18} />} loading={p.committing} disabled={!canCommit} onClick={p.onCommit}>
              {p.commitLabel}
            </Button>
          )}
        </div>
      )}

      <PickSheet
        opened={pick !== null}
        onClose={() => setPick(null)}
        title={p.fields.find((f) => f.key === pick)?.label ?? ""}
        options={p.headers
          .map((h, i) => {
            const ex = example(i);
            return { value: String(i), label: `${colLetter(i)}: ${h}${ex ? ` (np. ${ex.slice(0, 24)})` : ""}`, i };
          })
          .filter((o) => !used.has(o.i) || (pick && p.mapping[pick] === o.i))
          .map(({ value, label }) => ({ value, label }))}
        value={pick && p.mapping[pick] != null ? [String(p.mapping[pick])] : []}
        clearLabel="Nie importuj"
        onChange={(v) => pick && p.setMapping(pick, v[0] != null ? Number(v[0]) : null)}
      />
    </div>
  );
}
