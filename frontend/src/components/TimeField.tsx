import { useEffect, useState } from "react";
import { TextInput, type TextInputProps } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";

type Props = Omit<TextInputProps, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
};

const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/**
 * Godzina w formacie 24-godzinnym GG:MM niezależnie od języka telefonu (natywne pole pokazałoby „10:00 PM”).
 * Wpisuje się same cyfry – dwukropek dopisuje się sam; na telefonie klawiatura numeryczna. Wartość: „GG:MM” albo "".
 */
export function TimeField({ value, onChange, ...rest }: Props) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (value !== (valid(text) ? text : "")) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  function typed(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    // „9” → „09:” dopiero, gdy pierwsza cyfra nie może zaczynać godziny dwucyfrowej (3–9)
    let out = digits.length === 1 && Number(digits) > 2 ? `0${digits}` : digits;
    if (out.length > 2) out = `${out.slice(0, 2)}:${out.slice(2)}`;
    setText(out);
    onChange(valid(out) ? out : "");
  }
  const bad = text.length === 5 && !valid(text);
  return (
    <TextInput
      {...rest}
      inputMode="numeric"
      autoComplete="off"
      placeholder="gg:mm"
      maxLength={5}
      value={text}
      onChange={(e) => typed(e.currentTarget.value)}
      onBlur={(e) => {
        // „22” → „22:00”
        if (/^\d{2}$/.test(text) && Number(text) < 24) typed(`${text}00`);
        rest.onBlur?.(e);
      }}
      error={rest.error ?? (bad ? "Godzina 00:00–23:59" : undefined)}
      rightSection={<IconClock size={16} color="var(--mantine-color-dimmed)" aria-hidden />}
      rightSectionPointerEvents="none"
    />
  );
}
