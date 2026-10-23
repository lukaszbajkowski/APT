// Walidacja PESEL po stronie przeglądarki (natychmiastowa podpowiedź).
// Ostateczne sprawdzenie i tak robi serwer.

const WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
const CENTURY: Record<number, number> = { 80: 1800, 0: 1900, 20: 2000, 40: 2100, 60: 2200 };

export type PeselResult =
  | { valid: true; birthDate: string; sex: "K" | "M" }
  | { valid: false; message: string };

export function parsePesel(input: string): PeselResult {
  const pesel = input.replace(/\s+/g, "");
  if (!/^\d{11}$/.test(pesel)) return { valid: false, message: "PESEL musi składać się z 11 cyfr." };
  const d = pesel.split("").map(Number);
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * d[i], 0);
  if ((10 - (sum % 10)) % 10 !== d[10]) return { valid: false, message: "Nieprawidłowa cyfra kontrolna PESEL." };

  const yy = d[0] * 10 + d[1];
  const mm = d[2] * 10 + d[3];
  const dd = d[4] * 10 + d[5];
  const offset = Math.floor(mm / 20) * 20;
  const century = CENTURY[offset];
  if (century === undefined) return { valid: false, message: "Nieprawidłowy miesiąc w numerze PESEL." };
  const year = century + yy;
  const month = mm - offset;
  const date = new Date(Date.UTC(year, month - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dd) {
    return { valid: false, message: "Nieprawidłowa data urodzenia w numerze PESEL." };
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { valid: true, birthDate: iso, sex: d[9] % 2 === 0 ? "K" : "M" };
}
