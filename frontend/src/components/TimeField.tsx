import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionIcon, Drawer, Popover, TextInput, UnstyledButton, type TextInputProps } from "@mantine/core";

import { SheetHandle } from "./Mobile";
import { IconClock } from "@tabler/icons-react";

type Props = Omit<TextInputProps, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  /** krok minut w okienku wyboru (wpisać ręcznie można każdą minutę) */
  minuteStep?: number;
};

const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));

/**
 * Okienko wyboru godziny: najpierw godzina (siatka 00–23), potem minuty – wybór minut zamyka okienko.
 * Strzałki poruszają się po siatce, Enter wybiera.
 */
function TimePicker({ value, step, onPick }: { value: string; step: number; onPick: (v: string, done: boolean) => void }) {
  const [h, m] = valid(value) ? value.split(":") : ["", ""];
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step));
  const box = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLDivElement>, cols: number) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, (i < 0 ? 0 : i) + step))]?.focus();
  };
  return (
    <div className="ui-time" ref={box}>
      <div className="ui-time-label">Godzina</div>
      <div className="ui-time-grid" data-cols="6" role="group" aria-label="Godzina" onKeyDown={(e) => move(e, 6)}>
        {HOURS.map((x) => (
          <UnstyledButton
            key={x}
            className="ui-time-cell"
            data-selected={x === h || undefined}
            aria-pressed={x === h}
            onClick={() => onPick(`${x}:${m || "00"}`, false)}
          >
            {x}
          </UnstyledButton>
        ))}
      </div>
      <div className="ui-time-label">Minuty</div>
      <div className="ui-time-grid" data-cols="4" role="group" aria-label="Minuty" onKeyDown={(e) => move(e, 4)}>
        {minutes.map((x) => (
          <UnstyledButton
            key={x}
            className="ui-time-cell"
            data-selected={(!!h && x === m) || undefined}
            aria-pressed={!!h && x === m}
            onClick={() => onPick(`${h || "00"}:${x}`, true)}
          >
            :{x}
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}

/**
 * Godzina w formacie 24-godzinnym GG:MM niezależnie od języka telefonu (natywne pole pokazałoby „10:00 PM”).
 * Komputer: wpisuje się same cyfry (dwukropek dopisuje się sam) albo wybiera w okienku pod polem.
 * Telefon: stuknięcie otwiera okienko wyboru z dużymi polami (bez klawiatury). Wartość: „GG:MM” albo "".
 */
export function TimeField({ value, onChange, minuteStep = 5, ...rest }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  useEffect(() => {
    if (value !== (valid(text) ? text : "")) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  function typed(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    // „9” → „09” (godzina 3–9 nie może mieć drugiej cyfry)
    let out = digits.length === 1 && Number(digits) > 2 ? `0${digits}` : digits;
    if (out.length > 2) out = `${out.slice(0, 2)}:${out.slice(2)}`;
    setText(out);
    onChange(valid(out) ? out : "");
    if (valid(out)) setOpen(false);
  }
  const pick = (v: string, done: boolean) => {
    setText(v);
    onChange(v);
    if (done) setOpen(false);
  };
  const bad = text.length === 5 && !valid(text);
  const picker = <TimePicker value={valid(text) ? text : ""} step={minuteStep} onPick={pick} />;
  const label = typeof rest.label === "string" ? rest.label : "Godzina";
  return (
    <>
    {touch && (
      // telefon: panel od dołu z dużymi polami, jak inne wybory w aplikacji
      <Drawer opened={open} onClose={() => setOpen(false)} position="bottom" size="auto" radius="lg" withCloseButton={false} classNames={{ content: "ui-sheet" }} aria-label={label}>
        <SheetHandle onClose={() => setOpen(false)}>
          <div className="ui-sheet-head">
            <div className="ui-sheet-title">{text && valid(text) ? `${label} · ${text}` : label}</div>
          </div>
        </SheetHandle>
        <div className="ui-time-sheet">{picker}</div>
      </Drawer>
    )}
    <Popover opened={open && !touch} onChange={setOpen} position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>
        <TextInput
          {...rest}
          inputMode={touch ? "none" : "numeric"}
          readOnly={touch || rest.readOnly}
          autoComplete="off"
          placeholder="gg:mm"
          maxLength={5}
          value={text}
          onChange={(e) => typed(e.currentTarget.value)}
          onClick={(e) => {
            rest.onClick?.(e);
            if (!rest.disabled && !rest.readOnly) setOpen(true);
          }}
          onKeyDown={(e) => {
            rest.onKeyDown?.(e);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              window.setTimeout(() => document.querySelector<HTMLElement>(".ui-time-cell")?.focus(), 0);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          onBlur={(e) => {
            // „22” → „22:00”
            if (/^\d{2}$/.test(text) && Number(text) < 24) typed(`${text}00`);
            rest.onBlur?.(e);
          }}
          error={rest.error ?? (bad ? "Godzina 00:00–23:59" : undefined)}
          rightSection={
            <ActionIcon variant="subtle" color="gray" aria-label="Wybierz godzinę" disabled={rest.disabled} onClick={() => setOpen((o) => !o)}>
              <IconClock size={16} />
            </ActionIcon>
          }
        />
      </Popover.Target>
      <Popover.Dropdown p="xs">{picker}</Popover.Dropdown>
    </Popover>
    </>
  );
}
