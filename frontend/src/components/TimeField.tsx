import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionIcon, Button, Popover, TextInput, type TextInputProps } from "@mantine/core";

import { useNativeValue } from "../lib/nativeInput";
import { IconClock } from "@tabler/icons-react";

type Props = Omit<TextInputProps, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  /** krok minut na kółku (domyślnie co minutę, jak w budziku) */
  minuteStep?: number;
};

const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const pad = (n: number) => String(n).padStart(2, "0");
const ITEM = 40; // wysokość pozycji kółka (px)

/**
 * Kółko jak w budziku iPhone'a: kolumna przewijana palcem, kółkiem myszy albo strzałkami; wybór = pozycja na
 * środku (zaznaczony pas). Kliknięcie pozycji przewija ją na środek.
 */
function Wheel({ items, index, onIndex, label }: { items: string[]; index: number; onIndex: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (i: number, smooth = true) => ref.current?.scrollTo({ top: i * ITEM, behavior: smooth && !reduce ? "smooth" : "auto" });
  useEffect(() => {
    scrollTo(index, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM)));
      if (i !== index) onIndex(i);
    }, 90);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(items.length - 1, index + d));
    onIndex(i);
    scrollTo(i);
  };
  return (
    <div
      ref={ref}
      className="ui-wheel"
      role="spinbutton"
      aria-label={label}
      aria-valuetext={items[index]}
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKey}
    >
      {items.map((x, i) => (
        <div
          key={x}
          className="ui-wheel-item"
          data-on={i === index || undefined}
          onClick={() => {
            onIndex(i);
            scrollTo(i);
          }}
        >
          {x}
        </div>
      ))}
    </div>
  );
}

/** Dwa kółka (godziny i minuty) i „Gotowe”. Zmiana zapisuje się dopiero po „Gotowe”. */
function TimeWheels({ value, step, onDone }: { value: string; step: number; onDone: (v: string) => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => pad(i));
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step));
  // start: wpisana godzina albo najbliższa pełna „teraz” zaokrąglona w górę do kroku minut
  const init = () => {
    if (valid(value)) {
      const [h, m] = value.split(":").map(Number);
      return { h, m: Math.min(minutes.length - 1, Math.round(m / step)) };
    }
    const now = new Date();
    const mi = Math.ceil(now.getMinutes() / step);
    return mi >= minutes.length ? { h: (now.getHours() + 1) % 24, m: 0 } : { h: now.getHours(), m: mi };
  };
  const [sel, setSel] = useState(init);
  return (
    <div className="ui-wheels">
      <div className="ui-wheels-row">
        <Wheel items={hours} index={sel.h} onIndex={(h) => setSel((x) => ({ ...x, h }))} label="Godzina" />
        <span className="ui-wheels-colon" aria-hidden>
          :
        </span>
        <Wheel items={minutes} index={sel.m} onIndex={(m) => setSel((x) => ({ ...x, m }))} label="Minuty" />
        <div className="ui-wheels-band" aria-hidden />
      </div>
      <Button fullWidth size="md" radius="md" mt="sm" onClick={() => onDone(`${hours[sel.h]}:${minutes[sel.m]}`)}>
        Gotowe · {hours[sel.h]}:{minutes[sel.m]}
      </Button>
    </div>
  );
}

/**
 * Godzina w formacie 24-godzinnym GG:MM niezależnie od języka telefonu (natywne pole pokazałoby „10:00 PM”).
 * Komputer: wpisuje się same cyfry (dwukropek dopisuje się sam) albo wybiera na kółkach w okienku pod polem.
 * Telefon: stuknięcie otwiera systemowy wybór godziny (natywne pole). Wartość: „GG:MM” albo "".
 */
export function TimeField({ value, onChange, minuteStep = 1, style, className, ...rest }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const native = useRef<HTMLInputElement>(null);
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
  const pick = (v: string) => {
    setText(v);
    onChange(v);
    setOpen(false);
  };
  // natywne pole (systemowy wybór na telefonie) – także „Wyzeruj” w Safari czyści godzinę
  useNativeValue(native, valid(text) ? text : "", (v) => {
    setText(v);
    onChange(valid(v) ? v : "");
  });
  const bad = text.length === 5 && !valid(text);
  // kółka montują się od nowa przy każdym otwarciu – startują od aktualnej wartości pola
  const picker = open ? <TimeWheels value={valid(text) ? text : ""} step={minuteStep} onDone={pick} /> : null;
  return (
    <>
    <div style={{ position: "relative", ...(style as object) }} className={className}>
    {touch && !rest.disabled && !rest.readOnly && (
      // telefon: przezroczyste natywne pole nad polem – stuknięcie otwiera systemowy wybór godziny
      // (iOS: kółka, Android: zegar); wyświetlamy zawsze 24 h w polu pod spodem
      <input
        type="time"
        aria-label={typeof rest.label === "string" ? rest.label : "Godzina"}
        ref={native}
        defaultValue={valid(text) ? text : ""}
        style={{ position: "absolute", inset: 0, opacity: 0, zIndex: 2, width: "100%", height: "100%", fontSize: 16 }}
      />
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
              window.setTimeout(() => document.querySelector<HTMLElement>(".ui-wheel")?.focus(), 0);
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
    </div>
    </>
  );
}
