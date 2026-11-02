/*
 * Lista wyboru zgodna z zasadami „System mobilny”: na telefonie wybór otwiera panel od dołu (PickSheet),
 * na komputerze działa zwykły Select z Mantine. Zamiast `Select` z @mantine/core importuj ten.
 * Zwykły Select zostaje tam, gdzie lista jest długa i przeszukiwana (wpisywanie z klawiatury) albo grupowana.
 */
import { useState } from "react";
import { Combobox, Input, InputBase, Select as MantineSelect, type SelectProps } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { PickSheet } from "./Mobile";

type Opt = { value: string; label: string };

function flat(data: SelectProps["data"]): Opt[] | null {
  if (!data) return [];
  const out: Opt[] = [];
  for (const d of data as unknown[]) {
    if (typeof d === "string") out.push({ value: d, label: d });
    else if (d && typeof d === "object" && "value" in d) {
      const o = d as { value: string; label?: string };
      out.push({ value: o.value, label: o.label ?? o.value });
    } else return null; // grupy – zostaje zwykły Select
  }
  return out;
}

const LONG = 12;

export function Select(props: SelectProps) {
  const mobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const [open, setOpen] = useState(false);
  const opts = flat(props.data);
  if (!mobile || !opts || (props.searchable && opts.length > LONG)) return <MantineSelect {...props} />;

  const { label, description, error, placeholder, size, disabled, required, withAsterisk, value, onChange, clearable, w, style, className } = props;
  const current = opts.find((o) => o.value === value);
  return (
    <>
      <InputBase
        component="button"
        type="button"
        pointer
        label={label}
        description={description}
        error={error}
        size={size}
        disabled={disabled}
        required={required}
        withAsterisk={withAsterisk}
        w={w}
        style={style}
        className={className}
        rightSection={<Combobox.Chevron />}
        rightSectionPointerEvents="none"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {current ? current.label : <Input.Placeholder>{placeholder}</Input.Placeholder>}
      </InputBase>
      <PickSheet
        opened={open}
        onClose={() => setOpen(false)}
        title={typeof label === "string" ? label : placeholder ?? "Wybierz"}
        options={opts}
        value={value ? [value] : []}
        onChange={(v) => {
          const next = v[0] ?? null;
          onChange?.(next, next ? (opts.find((o) => o.value === next) as never) : (null as never));
        }}
        clearLabel={clearable && value ? "Wyczyść wybór" : undefined}
      />
    </>
  );
}
