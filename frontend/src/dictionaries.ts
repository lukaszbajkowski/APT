import { useQuery } from "@tanstack/react-query";
import { api, type CountryItem, type DictionaryItem, type PositionItem } from "./api";

// Słowniki zmieniają się rzadko – trzymamy je w pamięci 5 minut.
const STALE = 5 * 60 * 1000;

export const useAgencies = () =>
  useQuery({ queryKey: ["agencies"], queryFn: () => api<DictionaryItem[]>("/agencies"), staleTime: STALE });

export const useDepartments = () =>
  useQuery({ queryKey: ["departments"], queryFn: () => api<DictionaryItem[]>("/departments"), staleTime: STALE });

export const usePositions = () =>
  useQuery({ queryKey: ["positions"], queryFn: () => api<PositionItem[]>("/positions"), staleTime: STALE });

export const useCountries = () =>
  useQuery({ queryKey: ["countries"], queryFn: () => api<CountryItem[]>("/countries"), staleTime: STALE });

/** Opcje do Select: aktywne pozycje + aktualnie wybrana (nawet jeśli wyłączona). */
export function options<T extends { id: number; name: string; is_active: boolean }>(
  items: T[] | undefined,
  current?: number | null,
  filter?: (item: T) => boolean,
) {
  return (items ?? [])
    .filter((i) => (i.is_active || i.id === current) && (!filter || filter(i) || i.id === current))
    .map((i) => ({ value: String(i.id), label: i.is_active ? i.name : `${i.name} (wyłączone)` }));
}
