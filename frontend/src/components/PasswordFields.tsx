import { useState } from "react";
import { Box, Group, PasswordInput, Progress, Stack, Text } from "@mantine/core";
import { IconCheck, IconCircle } from "@tabler/icons-react";

/** Reguły takie same jak na serwerze (app/security.py: password_problems). */
export function passwordRules(pw: string, username?: string | null) {
  const classes = [/[a-ząćęłńóśźż]/.test(pw), /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(pw), /\d/.test(pw), /[^\p{L}\p{N}]/u.test(pw)].filter(Boolean).length;
  return [
    { ok: pw.length >= 12, label: "co najmniej 12 znaków" },
    { ok: classes >= 3, label: "co najmniej 3 z 4 grup: małe litery, wielkie litery, cyfry, znaki specjalne" },
    { ok: !username || !pw.toLowerCase().includes(username.toLowerCase()), label: "nie zawiera loginu" },
  ];
}

export function passwordOk(pw: string, repeat: string, username?: string | null): boolean {
  return passwordRules(pw, username).every((r) => r.ok) && pw === repeat && pw.length > 0;
}

/** Nowe hasło + powtórzenie: lista wymagań na żywo, siła hasła i błąd przy polu „powtórz”. */
export function NewPasswordFields({
  pw,
  repeat,
  onPw,
  onRepeat,
  username,
  label = "Nowe hasło",
  serverError,
}: {
  pw: string;
  repeat: string;
  onPw: (v: string) => void;
  onRepeat: (v: string) => void;
  username?: string | null;
  label?: string;
  serverError?: string | null;
}) {
  const [touched, setTouched] = useState(false);
  const rules = passwordRules(pw, username);
  const done = rules.filter((r) => r.ok).length;
  const mismatch = repeat.length > 0 && pw !== repeat;
  const color = done === 3 ? "teal" : done === 2 ? "yellow" : "red";
  return (
    <Stack gap="xs">
      <PasswordInput
        label={label}
        required
        autoComplete="new-password"
        value={pw}
        error={serverError || undefined}
        onChange={(e) => {
          onPw(e.currentTarget.value);
          setTouched(true);
        }}
      />
      {pw.length > 0 && <Progress value={(done / 3) * 100} color={color} size="xs" />}
      <Box>
        {rules.map((r) => (
          <Group key={r.label} gap={6} wrap="nowrap" align="flex-start">
            {r.ok ? <IconCheck size={14} color="var(--mantine-color-teal-6)" /> : <IconCircle size={14} color="var(--mantine-color-gray-5)" />}
            <Text size="xs" c={r.ok ? "teal" : touched && pw.length > 0 ? "red" : "dimmed"}>
              {r.label}
            </Text>
          </Group>
        ))}
      </Box>
      <PasswordInput
        label={`Powtórz ${label.toLowerCase().replace(/^nowe /, "")}`}
        required
        autoComplete="new-password"
        value={repeat}
        error={mismatch ? "Hasła nie są takie same – popraw to pole." : undefined}
        onChange={(e) => onRepeat(e.currentTarget.value)}
      />
      {repeat.length > 0 && !mismatch && pw.length > 0 && (
        <Text size="xs" c="teal">
          Hasła są takie same.
        </Text>
      )}
    </Stack>
  );
}
