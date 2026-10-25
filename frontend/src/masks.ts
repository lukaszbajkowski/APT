// Maski pól (ta sama logika co backend/app/masks.py): 9 = cyfra, A = litera, * = litera lub cyfra.
import type { TemplateField } from "./api";

export interface FormatPreset {
  value: string;
  label: string;
  mask: string;
}

const TOKENS = new Set(["9", "A", "*"]);

function fits(token: string, c: string) {
  if (token === "9") return /\d/.test(c);
  if (token === "A") return /\p{L}/u.test(c);
  return /[\p{L}\d]/u.test(c);
}

/** Formatuje w trakcie pisania: wstawia separatory, pomija znaki niepasujące, ucina nadmiar. */
export function maskPartial(value: string, mask: string): string {
  const chars = [...value].filter((c) => /[\p{L}\d]/u.test(c));
  let out = "";
  let i = 0;
  for (const m of mask) {
    if (i >= chars.length) break;
    if (TOKENS.has(m)) {
      while (i < chars.length && !fits(m, chars[i])) i++;
      if (i >= chars.length) break;
      out += chars[i].toUpperCase();
      i++;
    } else {
      out += m;
    }
  }
  return out;
}

export function maskComplete(value: string, mask: string): boolean {
  return value.length === mask.length && maskPartial(value, mask) === value;
}

export function maskExample(mask: string): string {
  return mask.replace(/9/g, "0").replace(/A/g, "X").replace(/\*/g, "X");
}

/** Maska dla pola (preset albo własna); "" = bez maski (np. e-mail). */
export function fieldMask(field: TemplateField, presets: FormatPreset[] | undefined): string {
  if (!field.format) return "";
  if (field.format === "custom") return field.pattern ?? "";
  return presets?.find((p) => p.value === field.format)?.mask ?? "";
}

export function fieldProblem(field: TemplateField, value: string, presets: FormatPreset[] | undefined): string | null {
  if (!value || !field.format) return null;
  if (field.format === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value.trim()) ? null : "nieprawidłowy e-mail";
  const mask = fieldMask(field, presets);
  if (mask && !maskComplete(value, mask)) return `format ${maskExample(mask)}`;
  return null;
}

// ---- PESEL ----

const WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];

export function peselProblem(value: string): string | null {
  const v = value.replace(/\s/g, "");
  if (!v) return null;
  if (!/^\d{11}$/.test(v)) return "PESEL musi mieć 11 cyfr";
  const d = [...v].map(Number);
  const check = (10 - (WEIGHTS.reduce((s, w, i) => s + w * d[i], 0) % 10)) % 10;
  if (check !== d[10]) return "nieprawidłowa cyfra kontrolna";
  return null;
}
