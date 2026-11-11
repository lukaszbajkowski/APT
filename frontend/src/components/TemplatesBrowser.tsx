import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Image, SegmentedControl, Skeleton, Text, TextInput, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconFileTypeDocx, IconSearch } from "@tabler/icons-react";
import { useElementSize } from "@mantine/hooks";

import { api, DOWNLOAD_FORMAT_LABELS, errorText, formatDate, formatDateTime, LANGUAGES, withAcct, type DocTemplate } from "../api";
import { useUrlOpen } from "../lib/urlState";
import { MasterDetail } from "./MasterDetail";
import { PageTitle, RowMenu, SectionHead } from "./Mobile";

interface Usage {
  template_id: number;
  count: number;
  last_used_at: string | null;
}
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
const fieldsText = (n: number) => `${n} ${plural(n, "pole", "pola", "pól")}`;
function ago(iso: string) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "dziś" : d === 1 ? "wczoraj" : d < 30 ? `${d} dni temu` : formatDate(iso.slice(0, 10));
}

/**
 * Szablony na komputerze (wariant A): lista z wyszukiwarką i filtrem po lewej, szczegóły wybranego obok –
 * podgląd pierwszej strony, co wstawia się samo, o co aplikacja zapyta, kto może używać i ile razy użyto.
 */
export function TemplatesBrowser({ templates, loading, onAdd }: { templates: DocTemplate[] | undefined; loading: boolean; onAdd: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useUrlOpen();
  const usage = useQuery({ queryKey: ["templates-usage"], queryFn: () => api<Usage[]>("/templates-usage") });
  const use = useMemo(() => new Map((usage.data ?? []).map((u) => [u.template_id, u])), [usage.data]);
  const all = useMemo(
    () => [...(templates ?? [])].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, "pl")),
    [templates],
  );
  const counts = {
    all: all.length,
    used: all.filter((t) => (use.get(t.id)?.count ?? 0) > 0).length,
    pesel: all.filter((t) => t.sensitive).length,
    off: all.filter((t) => !t.is_active).length,
  };
  const needle = q.trim().toLowerCase();
  const shown = all.filter(
    (t) =>
      (!needle || t.name.toLowerCase().includes(needle)) &&
      (filter === "all" || (filter === "used" && (use.get(t.id)?.count ?? 0) > 0) || (filter === "pesel" && t.sensitive) || (filter === "off" && !t.is_active)),
  );
  // za mało miejsca na listę i szczegóły obok siebie: jedno naraz (jak poczta na telefonie)
  const { ref: box, width } = useElementSize();
  const single = width > 0 && width < 1040; // szczegóły muszą mieć co najmniej ~640 px
  const current = all.find((t) => t.id === openId) ?? (single ? null : shown[0]) ?? null;

  const list = (
    <>
      <div className="ui-tpl-tools">
        <TextInput aria-label="Szukaj szablonu" placeholder="Szukaj szablonu" leftSection={<IconSearch size={16} aria-hidden />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        {loading ? (
          <Skeleton height={30} radius="md" />
        ) : (
        <SegmentedControl
          fullWidth
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[
            { value: "all", label: `Wszystkie ${counts.all}` },
            { value: "used", label: `Używane ${counts.used}` },
            { value: "pesel", label: `Z PESEL ${counts.pesel}` },
            ...(counts.off ? [{ value: "off", label: `Wyłączone ${counts.off}` }] : []),
          ]}
        />
        )}
      </div>
      <div className="ui-tpl-scroll">
        {loading &&
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="ui-tpl-item" aria-hidden>
              <Skeleton width={24} height={28} radius={4} />
              <span style={{ flex: 1 }}>
                <Skeleton height={12} width={`${70 - (i % 3) * 12}%`} mb={6} />
                <Skeleton height={9} width="40%" />
              </span>
            </div>
          ))}
        {!loading && shown.length === 0 && (
          <Text size="sm" c="dimmed" p="md">
            {all.length ? "Brak szablonów dla tego wyszukiwania." : "Brak szablonów. Dodaj pierwszy plik Word ze znacznikami {{ … }}."}
          </Text>
        )}
        {shown.map((t) => {
          const u = use.get(t.id);
          const meta = [fieldsText(t.fields.length), t.language !== "pl" ? (LANGUAGES[t.language] ?? t.language).toLowerCase() : null, t.is_active ? (u?.count ? `${u.count} ${plural(u.count, "raz", "razy", "razy")}` : "nieużywany") : "wyłączony"]
            .filter(Boolean)
            .join(" · ");
          return (
            <UnstyledButton
              key={t.id}
              className="ui-tpl-item"
              data-selected={current?.id === t.id || undefined}
              data-off={!t.is_active || undefined}
              aria-current={current?.id === t.id || undefined}
              onClick={() => setOpenId(t.id)}
            >
              <IconFileTypeDocx size={24} aria-hidden className="ui-tpl-ico" />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="ui-tpl-name">{t.name}</span>
                <span className="ui-tpl-meta">{meta}</span>
              </span>
              {t.sensitive && t.is_active && <span className="ui-tpl-pesel">PESEL</span>}
            </UnstyledButton>
          );
        })}
      </div>
    </>
  );

  return (
    <div ref={box} className={single ? "ui-tpl-single" : undefined}>
    <MasterDetail
      mobile={false}
      showList={!single || !current}
      showRight={!single || !!current}
      head={
        <PageTitle
          title="Szablony dokumentów"
          meta={templates ? `${all.length} ${plural(all.length, "szablon", "szablony", "szablonów")}${counts.off ? ` · ${counts.off} ${plural(counts.off, "wyłączony", "wyłączone", "wyłączonych")}` : ""}` : undefined}
          actions={<Button onClick={onAdd}>Dodaj szablon</Button>}
        />
      }
      list={list}
      detail={
        current ? (
          <TemplateDetail key={current.id} t={current} usage={use.get(current.id)} usageLoading={usage.isLoading} onBack={single ? () => setOpenId(null) : undefined} />
        ) : loading ? (
          <TemplateDetailSkeleton />
        ) : (
          <div />
        )
      }
      plainDetail
    />
    </div>
  );
}

/**
 * Znaczniki pól: pierwsze 4 i „Pokaż więcej (n)”, które rozwija resztę („Pokaż mniej” zwija) – mniej przewijania.
 */
function Chips({ items }: { items: { key: string; text: string; warn?: boolean }[] }) {
  const [all, setAll] = useState(false);
  const LIMIT = 4;
  return (
    <span className="ui-tpl-chips" data-all={all || undefined}>
      {items.map((it, i) => (
        <span key={it.key} className="ui-case-chip" data-warn={it.warn || undefined} data-extra={i >= LIMIT || undefined}>
          {it.text}
        </span>
      ))}
      {items.length > LIMIT && (
        <button type="button" className="ui-case-chip ui-tpl-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? "Pokaż mniej" : `Pokaż więcej (${items.length - LIMIT})`}
        </button>
      )}
    </span>
  );
}

function TemplateDetail({ t, usage, usageLoading, onBack }: { t: DocTemplate; usage?: Usage; usageLoading?: boolean; onBack?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [thumbOk, setThumbOk] = useState(true);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const builtins = useQuery({ queryKey: ["template-builtins"], queryFn: () => api<{ key: string; label: string }[]>("/templates/builtins") });
  const label = (k: string) => builtins.data?.find((b) => b.key === k)?.label ?? k;
  const SENS = new Set(["pesel", "data_urodzenia", "birth_date"]);
  const recent = useQuery({
    queryKey: ["template-recent", t.id],
    queryFn: () => api<{ employee_id: number; employee: string; created_at: string; created_by_name: string | null }[]>(`/templates/${t.id}/recent`),
  });
  const toggle = useMutation({
    mutationFn: () => api(`/templates/${t.id}`, { method: "PATCH", body: { is_active: !t.is_active } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      notifications.show({ color: "teal", message: t.is_active ? "Szablon wyłączony." : "Szablon włączony." });
    },
    onError: (e) => notifications.show({ color: "red", message: errorText(e) }),
  });
  return (
    <div className="ui-tpl-detail">
      {onBack && (
        <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={16} />} onClick={onBack} mb="md" ml={-8}>
          Wszystkie szablony
        </Button>
      )}
      <div className="ui-tpl-grid">
      <div className="ui-tpl-left">
      <div className="ui-tpl-page">
        {thumbOk ? (
          <>
            {!thumbLoaded && <Skeleton className="ui-tpl-thumb-skel" radius={0} />}
            <Image
              src={withAcct(`/api/templates/${t.id}/thumbnail?v=${t.version}`)}
              alt={`Pierwsza strona: ${t.name}`}
              onLoad={() => setThumbLoaded(true)}
              onError={() => setThumbOk(false)}
              className="ui-tpl-thumb"
              data-loaded={thumbLoaded || undefined}
            />
          </>
        ) : (
          <div className="ui-tpl-noprev">
            <IconFileTypeDocx size={40} aria-hidden />
            <span>Podgląd niedostępny</span>
          </div>
        )}
      </div>
        <section className="ui-dsec ui-tpl-recent-sec">
          <SectionHead title="Ostatnio wygenerowane" extra={usage?.count ? <Text c="dimmed">{usage.count}</Text> : undefined} />
          {recent.isLoading ? (
            <Skeleton height={44} radius="md" />
          ) : !recent.data?.length ? (
            <Text size="sm" c="dimmed">
              Z tego szablonu nie powstał jeszcze żaden dokument.
            </Text>
          ) : (
            <div className="ui-cases ui-tpl-recent">
              {recent.data.map((r, i) => (
                <div key={i} className="ui-tpl-recent-row">
                  <Link to={`/pracownicy/${r.employee_id}`} className="ui-case-link">
                    {r.employee}
                  </Link>
                  <span className="ui-tpl-meta">
                    {formatDateTime(r.created_at)}
                    {r.created_by_name ? ` · ${r.created_by_name}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="ui-tpl-dhead">
          <h2 className="ui-dsec-title">{t.name}</h2>
        </div>
        <Text size="sm" c="dimmed" mb="md">
          Wersja {t.version} · zmieniony {formatDate(t.updated_at.slice(0, 10))} · plik {t.original_filename}
        </Text>
        {t.description && <Text mb="md">{t.description}</Text>}
        <dl className="ui-tpl-kv">
          <dt>Język</dt>
          <dd>{LANGUAGES[t.language] ?? t.language}</dd>
          <dt>Pobieranie</dt>
          <dd>{DOWNLOAD_FORMAT_LABELS[t.download_formats]}</dd>
          <dt>Dane z kartoteki</dt>
          <dd>
            {t.builtins.length ? (
              <Chips items={t.builtins.map((b) => ({ key: b, text: label(b), warn: SENS.has(b) }))} />
            ) : (
              <Text span c="dimmed">Żadne</Text>
            )}
          </dd>
          <dt>Pyta przy generowaniu</dt>
          <dd>{t.fields.length ? <Chips items={t.fields.map((f) => ({ key: f.key, text: f.label }))} /> : <Text span c="dimmed">O nic</Text>}</dd>
          <dt>Kierownik</dt>
          <dd>{t.allow_manager ? (t.sensitive ? "Może wygenerować – bez PESEL i daty urodzenia" : "Może wygenerować") : "Nie widzi szablonu"}</dd>
          <dt>Użycie</dt>
          <dd>{usageLoading ? <Skeleton height={12} width={180} mt={4} /> : usage?.count ? `${usage.count} ${plural(usage.count, "dokument", "dokumenty", "dokumentów")} · ostatnio ${ago(usage.last_used_at!)}` : "Jeszcze nieużyty"}</dd>
        </dl>
        <div className="ui-tpl-actions">
          <Button variant="default" onClick={() => navigate(`/szablony/${t.id}`)}>
            Edytuj ustawienia i pola
          </Button>
          {/* „⋯” trzyma się ostatniego przycisku – nie zostaje samo w nowej linii */}
          <span className="ui-tpl-actions-end">
          <Button variant="default" onClick={() => navigate(`/szablony/${t.id}#plik`)}>
            Wgraj nową wersję
          </Button>
          <RowMenu
            label={t.name}
            items={[
              { label: "Pobierz plik .docx", onClick: () => window.open(withAcct(`/api/templates/${t.id}/file`), "_blank") },
              { label: t.is_active ? "Wyłącz szablon" : "Włącz szablon", onClick: () => toggle.mutate() },
            ]}
          />
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}

/** Szkielet szczegółów szablonu: podgląd strony, tytuł, wiersze opisu i przyciski – ten sam układ co treść. */
function TemplateDetailSkeleton() {
  return (
    <div className="ui-tpl-detail" aria-busy="true" aria-label="Ładowanie">
      <div className="ui-tpl-grid">
        <div className="ui-tpl-left">
          <Skeleton className="ui-tpl-thumb-skel" radius={6} />
          <div>
            <Skeleton height={14} width="70%" mb={12} />
            <Skeleton height={44} radius="md" />
          </div>
        </div>
        <div>
          <Skeleton height={20} width="55%" mb={8} />
          <Skeleton height={12} width="75%" mb={24} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, marginBottom: 16 }}>
              <Skeleton height={12} width="60%" />
              <Skeleton height={12} width={`${75 - (i % 3) * 15}%`} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
            <Skeleton height={36} width={190} radius="sm" />
            <Skeleton height={36} width={170} radius="sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
