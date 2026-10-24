import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Button, Checkbox, Group, Loader, Modal, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPrinter } from "@tabler/icons-react";

import { api, apiDownload, errorText } from "../api";

interface PersonRef {
  id: number;
  number: string;
  name: string;
}

interface Check {
  count: number;
  without_photo: PersonRef[];
  terminated: PersonRef[];
}

const LAYOUT_KEY = "apt.cards.layout";

function savedLayout(): "a4" | "cr80" {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "cr80" ? "cr80" : "a4";
  } catch {
    return "a4";
  }
}

function PeopleList({ people }: { people: PersonRef[] }) {
  const shown = people.slice(0, 8);
  return (
    <Text size="sm" component="div">
      {shown.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ", "}
          <Anchor component={Link} to={`/pracownicy/${p.id}`} target="_blank" size="sm">
            {p.name}
          </Anchor>
        </span>
      ))}
      {people.length > shown.length && ` i ${people.length - shown.length} innych`}
    </Text>
  );
}

export function PrintCardsModal({ ids, opened, onClose }: { ids: number[]; opened: boolean; onClose: () => void }) {
  const [layout, setLayout] = useState<"a4" | "cr80">(savedLayout);
  const [withExpiry, setWithExpiry] = useState(false);
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useQuery({
    queryKey: ["cards-check", ids],
    queryFn: () => api<Check>("/cards/check", { method: "POST", body: { employee_ids: ids } }),
    enabled: opened && ids.length > 0,
  });

  useEffect(() => {
    if (opened) setError(null);
  }, [opened]);

  async function print() {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      /* tryb prywatny – trudno */
    }
    try {
      await apiDownload(
        "/cards/pdf",
        { employee_ids: ids, layout, valid_until: withExpiry ? validUntil : null },
        "karty.pdf",
      );
      notifications.show({ color: "green", message: "Plik PDF z kartami został pobrany." });
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const sheets = Math.ceil(ids.length / 10);

  return (
    <Modal opened={opened} onClose={onClose} title={ids.length === 1 ? "Druk karty" : `Druk kart (${ids.length})`}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        {check.isLoading && <Loader size="sm" />}
        {check.data && check.data.without_photo.length > 0 && (
          <Alert color="orange" title={`Bez zdjęcia: ${check.data.without_photo.length}`}>
            <Text size="sm" mb={4}>
              Na tych kartach zamiast zdjęcia będzie szary symbol osoby:
            </Text>
            <PeopleList people={check.data.without_photo} />
          </Alert>
        )}
        {check.data && check.data.terminated.length > 0 && (
          <Alert color="gray" title={`W archiwum: ${check.data.terminated.length}`}>
            <PeopleList people={check.data.terminated} />
          </Alert>
        )}

        <div>
          <Text size="sm" fw={500} mb={4}>
            Układ wydruku
          </Text>
          <SegmentedControl
            fullWidth
            value={layout}
            onChange={(v) => setLayout(v as "a4" | "cr80")}
            data={[
              { value: "a4", label: "Arkusz A4 (10 kart)" },
              { value: "cr80", label: "Drukarka kart (CR80)" },
            ]}
          />
          <Text size="xs" c="dimmed" mt={4}>
            {layout === "a4"
              ? `Karty 85,6 × 54 mm na arkuszu ze znacznikami cięcia${ids.length > 1 ? ` – arkuszy: ${sheets}` : ""}. Drukuj w skali 100%.`
              : "Jedna karta na stronę w rozmiarze karty – dla drukarek kart PVC."}
          </Text>
        </div>

        <Checkbox
          label="Data ważności na karcie"
          checked={withExpiry}
          onChange={(e) => setWithExpiry(e.currentTarget.checked)}
        />
        {withExpiry && (
          <TextInput type="date" label="Ważna do" value={validUntil} onChange={(e) => setValidUntil(e.currentTarget.value)} />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            leftSection={<IconPrinter size={16} />}
            loading={busy}
            disabled={!check.data || (withExpiry && !validUntil)}
            onClick={print}
          >
            Pobierz PDF
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
