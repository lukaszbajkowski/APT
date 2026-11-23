import type { UseQueryResult } from "@tanstack/react-query";

import { useAgencies, useCountries, useDepartments, usePositions } from "../dictionaries";
import { DictionaryDesk, type DictItem, type DictKind } from "../components/DictionaryDesk";

/** Słowniki (APT, wydziały, stanowiska, kraje) – komputer i telefon w components/DictionaryDesk (jak Checklisty). */
export function DictionariesPage() {
  const agencies = useAgencies();
  const departments = useDepartments();
  const positions = usePositions();
  const countries = useCountries();
  return <DictionaryDesk queries={{ agencies, departments, positions, countries } as Record<DictKind, UseQueryResult<DictItem[]>>} />;
}
