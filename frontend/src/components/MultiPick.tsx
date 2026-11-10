import { CloseButton, Combobox, Group, InputBase, Text, useCombobox } from "@mantine/core";
import { IconCheck, IconSelector } from "@tabler/icons-react";

/**
 * Wybór wielu opcji w jednej linii (filtry): pole pokazuje podsumowanie zamiast rosnących „pigułek”,
 * lista z zaznaczeniami zostaje otwarta przy kolejnych kliknięciach. Tylko wybór – bez pisania.
 */
export function MultiPick({
  label,
  options,
  value,
  onChange,
  summary,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  /** tekst w polu, gdy coś wybrano (domyślnie: jedna nazwa albo „<etykieta>: n”) */
  summary?: (picked: { value: string; label: string }[]) => string;
}) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const picked = options.filter((o) => value.includes(o.value));
  const text = !picked.length ? null : summary ? summary(picked) : picked.length === 1 ? picked[0].label : `${label}: ${picked.length}`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Combobox store={combobox} onOptionSubmit={toggle} withinPortal width="max-content" position="bottom-start">
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={combobox.dropdownOpened}
          onClick={() => combobox.toggleDropdown()}
          rightSectionPointerEvents={picked.length ? "all" : "none"}
          rightSection={
            picked.length ? (
              <CloseButton size="sm" aria-label={`Wyczyść: ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange([])} />
            ) : (
              <IconSelector size={16} />
            )
          }
        >
          {text ? (
            <Text span size="sm" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
              {text}
            </Text>
          ) : (
            <Text span size="sm" c="dimmed">
              {label}
            </Text>
          )}
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          {options.map((o) => (
            <Combobox.Option key={o.value} value={o.value} active={value.includes(o.value)} aria-selected={value.includes(o.value)}>
              <Group gap={8} wrap="nowrap">
                <span style={{ width: 16, display: "inline-flex" }}>{value.includes(o.value) && <IconCheck size={16} />}</span>
                <span style={{ whiteSpace: "nowrap" }}>{o.label}</span>
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
