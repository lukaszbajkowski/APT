"""Walidacja numeru PESEL."""

from dataclasses import dataclass
from datetime import date

WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)

# Przesunięcie miesiąca -> stulecie
_CENTURY = {80: 1800, 0: 1900, 20: 2000, 40: 2100, 60: 2200}


@dataclass(frozen=True)
class PeselInfo:
    birth_date: date
    sex: str  # "K" albo "M"


class PeselError(ValueError):
    pass


def normalize(value: str) -> str:
    return "".join(ch for ch in value if not ch.isspace())


def parse(value: str) -> PeselInfo:
    """Sprawdza PESEL i zwraca zakodowaną w nim datę urodzenia i płeć."""
    pesel = normalize(value)
    if len(pesel) != 11 or not pesel.isdigit():
        raise PeselError("PESEL musi składać się z 11 cyfr.")
    digits = [int(c) for c in pesel]
    checksum = (10 - sum(d * w for d, w in zip(digits[:10], WEIGHTS, strict=True)) % 10) % 10
    if checksum != digits[10]:
        raise PeselError("Nieprawidłowa cyfra kontrolna PESEL.")

    yy = digits[0] * 10 + digits[1]
    mm = digits[2] * 10 + digits[3]
    dd = digits[4] * 10 + digits[5]
    offset = (mm // 20) * 20
    century = _CENTURY.get(offset)
    if century is None:
        raise PeselError("Nieprawidłowy miesiąc w numerze PESEL.")
    try:
        born = date(century + yy, mm - offset, dd)
    except ValueError as exc:
        raise PeselError("Nieprawidłowa data urodzenia w numerze PESEL.") from exc
    sex = "K" if digits[9] % 2 == 0 else "M"
    return PeselInfo(birth_date=born, sex=sex)
