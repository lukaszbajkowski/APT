import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconFileTypeDocx, IconPlus, IconUpload } from "@tabler/icons-react";

import { api, DOWNLOAD_FORMAT_LABELS, errorText, formatDateTime, LANGUAGES, type DocTemplate } from "../api";
import { ErrorState, Loading } from "../components/States";

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }));

export function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ["templates", "all"], queryFn: () => api<DocTemplate[]>("/templates") });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pl");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append("file", file!);
      f.append("name", name);
      f.append("language", language);
      if (description.trim()) f.append("description", description);
      return api<DocTemplate>("/templates", { method: "POST", form: f });
    },
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setOpen(false);
      navigate(`/szablony/${t.id}`);
    },
    onError: (e) => setError(errorText(e)),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Szablony dokumentów</Title>
          <Text size="sm" c="dimmed">
            Dokumenty Word (.docx) ze znacznikami {"{{ … }}"}. Dane z kartoteki wstawiają się same, o resztę
            aplikacja zapyta przy generowaniu.
          </Text>
        </div>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setName("");
            setDescription("");
            setFile(null);
            setLanguage("pl");
            setError(null);
            setOpen(true);
          }}
        >
          Dodaj szablon
        </Button>
      </Group>

      {templates.isLoading && <Loading />}
      {templates.error && <ErrorState error={templates.error} onRetry={() => templates.refetch()} />}
      {templates.data && templates.data.length === 0 && (
        <Alert color="blue">
          Nie ma jeszcze żadnego szablonu. Dodaj pierwszy, np. deklarację Medicover (plik{" "}
          <code>examples/szablony/medicover_deklaracja.docx</code> w repozytorium).
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {templates.data?.map((t) => (
          <Card
            key={t.id}
            withBorder
            padding="lg"
            component={Link}
            to={`/szablony/${t.id}`}
            style={{ opacity: t.is_active ? 1 : 0.6 }}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <IconFileTypeDocx size={28} color="var(--mantine-color-navy-6)" />
                <Text fw={600}>{t.name}</Text>
              </Group>
              {!t.is_active && <Badge color="gray">wyłączony</Badge>}
            </Group>
            {t.description && (
              <Text size="sm" c="dimmed" mt={6} lineClamp={2}>
                {t.description}
              </Text>
            )}
            <Group gap={6} mt="sm">
              <Badge variant="light">{LANGUAGES[t.language] ?? t.language}</Badge>
              <Badge variant="light" color="gray">
                wersja {t.version}
              </Badge>
              <Badge variant="light" color="teal">
                pól do wypełnienia: {t.fields.length}
              </Badge>
              {t.sensitive && (
                <Badge variant="light" color="orange">
                  zawiera PESEL / datę ur.
                </Badge>
              )}
              <Badge variant="light" color={t.allow_manager ? "blue" : "gray"}>
                {t.allow_manager ? (t.sensitive ? "kierownik: bez PESEL" : "kierownik: tak") : "kierownik: nie"}
              </Badge>
              <Badge variant="light" color="grape">
                pobieranie: {DOWNLOAD_FORMAT_LABELS[t.download_formats]}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              Zmieniony {formatDateTime(t.updated_at)}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <Modal opened={open} onClose={() => setOpen(false)} title="Nowy szablon">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <FileInput
              label="Plik Word (.docx)"
              required
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              leftSection={<IconUpload size={16} />}
              value={file}
              onChange={(f) => {
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.docx$/i, "").replace(/[_-]+/g, " "));
              }}
              placeholder="Wybierz plik"
            />
            <TextInput label="Nazwa" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Select
              label="Język dokumentu"
              data={LANGUAGE_OPTIONS}
              allowDeselect={false}
              value={language}
              onChange={(v) => v && setLanguage(v)}
            />
            <Textarea
              label="Opis (opcjonalnie)"
              autosize
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                Anuluj
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!file || !name.trim()}>
                Wgraj i sprawdź
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
