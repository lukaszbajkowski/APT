import { useEffect, useRef, useState } from "react";
import { ActionIcon, Popover, TextInput, type TextInputProps } from "@mantine/core";

import { MonthCalendar } from "./MonthCalendar";
import { IconCalendar } from "@tabler/icons-react";

const toDisplay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};
function toIso(display: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(display);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getFullYear() !== Number(m[3]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[1])) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type Props = Omit<TextInputProps, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (e: { currentTarget: { value: string } }) => void;
  min?: string;
  max?: string;
};

/** Data w polskim formacie DD.MM.RRRR (niezależnym od języka przeglądarki) + wybór z kalendarza. Wartość: RRRR-MM-DD. */
export function DateField({ value, onChange, min, max, ...rest }: Props) {
  const [text, setText] = useState(toDisplay(value));
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // komputer: własny kalendarz w okienku (natywnego Safari na macOS nie da się zamknąć po wyborze dnia)
  const [calOpen, setCalOpen] = useState(false);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const openPicker = () => {
    if (!touch) return setCalOpen((o) => !o);
    try {
      picker.current?.showPicker?.();
    } catch {
      picker.current?.focus();
    }
  };
  useEffect(() => {
    // zmiana z zewnątrz (np. wczytanie formularza); nie nadpisujemy tego, co użytkownik właśnie wpisuje
    if (value !== (toIso(text) ?? "")) setText(toDisplay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  function typed(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let out = digits.slice(0, 2);
    if (digits.length > 2) out += "." + digits.slice(2, 4);
    if (digits.length > 4) out += "." + digits.slice(4);
    setText(out);
    if (out === "") onChange({ currentTarget: { value: "" } });
    const iso = toIso(out);
    if (iso) onChange({ currentTarget: { value: iso } });
  }
  const invalid = text.length === 10 && toIso(text) === null;
  const outOfRange = value && ((min && value < min) || (max && value > max));
  return (
    <div style={{ position: "relative" }}>
      <Popover opened={calOpen && !touch} onChange={setCalOpen} position="bottom-start" shadow="md" withinPortal>
        <Popover.Target>
      <TextInput
        {...rest}
        ref={field}
        inputMode="numeric"
        placeholder="dd.mm.rrrr"
        maxLength={10}
        value={text}
        error={rest.error ?? (invalid ? "Nieprawidłowa data – wpisz dd.mm.rrrr." : outOfRange ? "Data poza dozwolonym zakresem." : undefined)}
        onChange={(e) => typed(e.currentTarget.value)}
        onKeyDown={(e) => {
          rest.onKeyDown?.(e);
          // strzałka w dół – przejście do kalendarza; Esc – zamknięcie
          if (!touch && e.key === "ArrowDown") {
            e.preventDefault();
            setCalOpen(true);
            window.setTimeout(() => document.querySelector<HTMLElement>(".ui-cal-day[tabindex='0']")?.focus(), 0);
          }
          if (e.key === "Escape" && calOpen) setCalOpen(false);
        }}
        // kliknięcie w pole od razu otwiera kalendarz; na telefonie bez klawiatury (tylko kalendarz)
        readOnly={touch || rest.readOnly}
        onClick={(e) => {
          rest.onClick?.(e);
          // kliknięcie w pole otwiera kalendarz (nie zamyka – można też pisać datę z klawiatury)
          if (!rest.disabled && !rest.readOnly) (touch ? openPicker() : setCalOpen(true));
        }}
        rightSection={
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Wybierz z kalendarza"
            disabled={rest.disabled}
            onClick={openPicker}
          >
            <IconCalendar size={16} />
          </ActionIcon>
        }
      />
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <MonthCalendar
            value={value}
            min={min}
            max={max}
            onPick={(v) => {
              setText(toDisplay(v));
              onChange({ currentTarget: { value: v } });
              setCalOpen(false);
            }}
          />
        </Popover.Dropdown>
      </Popover>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          setText(toDisplay(e.target.value));
          onChange({ currentTarget: { value: e.target.value } });
        }}
        // telefon: przezroczyste natywne pole nad całym polem – stuknięcie otwiera systemowy kalendarz (niezawodne w Safari)
        style={
          touch && !rest.disabled && !rest.readOnly
            ? { position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", zIndex: 2, fontSize: 16 }
            : { position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }
        }
      />
    </div>
  );
}
