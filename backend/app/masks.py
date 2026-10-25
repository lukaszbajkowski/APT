"""Formaty (maski) pól formularza dokumentu: kod pocztowy, telefon, NIP, nr konta itp.

Maska: `9` = cyfra, `A` = litera, `*` = litera lub cyfra, inne znaki wstawiane automatycznie.
Ta sama logika jest w frontend/src/masks.ts (podpowiedzi i formatowanie podczas pisania).
"""

import re

PRESETS: dict[str, dict[str, str]] = {
    "postal": {"label": "Kod pocztowy (00-000)", "mask": "99-999"},
    "phone": {"label": "Telefon (000 000 000)", "mask": "999 999 999"},
    "nip": {"label": "NIP (000-000-00-00)", "mask": "999-999-99-99"},
    "regon": {"label": "REGON (9 cyfr)", "mask": "999999999"},
    "id_card": {"label": "Nr dowodu osobistego (ABC 123456)", "mask": "AAA 999999"},
    "iban": {"label": "Nr konta (26 cyfr)", "mask": "99 9999 9999 9999 9999 9999 9999"},
    "pesel": {"label": "PESEL (11 cyfr)", "mask": "99999999999"},
    "email": {"label": "Adres e-mail", "mask": ""},
}

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
_TOKENS = {"9", "A", "*"}


class MaskError(ValueError):
    pass


def valid_pattern(pattern: str) -> bool:
    return 0 < len(pattern) <= 60 and any(c in _TOKENS for c in pattern)


def apply_mask(value: str, mask: str) -> str:
    """Formatuje wartość według maski; MaskError, gdy znaki nie pasują lub jest ich za mało/za dużo."""
    chars = [c for c in value if c.isalnum()]
    out: list[str] = []
    i = 0
    for m in mask:
        if m in _TOKENS:
            if i >= len(chars):
                raise MaskError("za mało znaków")
            c = chars[i]
            if (m == "9" and not c.isdigit()) or (m == "A" and not c.isalpha()):
                raise MaskError("nieprawidłowe znaki")
            out.append(c.upper())
            i += 1
        else:
            out.append(m)
    if i != len(chars):
        raise MaskError("za dużo znaków")
    return "".join(out)


def _nip_ok(digits: str) -> bool:
    w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
    return sum(int(d) * k for d, k in zip(digits[:9], w, strict=True)) % 11 == int(digits[9])


def _regon_ok(digits: str) -> bool:
    w = [8, 9, 2, 3, 4, 5, 6, 7]
    return sum(int(d) * k for d, k in zip(digits[:8], w, strict=True)) % 11 % 10 == int(digits[8])


def _iban_pl_ok(digits: str) -> bool:
    # PL = 25 21; przeniesienie 4 pierwszych znaków (PL + 2 cyfry kontrolne) na koniec
    num = digits[2:] + "2521" + digits[:2]
    return int(num) % 97 == 1


def _pesel_ok(digits: str) -> bool:
    from app.pesel import PeselError, parse

    try:
        parse(digits)
        return True
    except PeselError:
        return False


_CHECKS = {"nip": _nip_ok, "regon": _regon_ok, "iban": _iban_pl_ok, "pesel": _pesel_ok}
_CHECK_MSG = {
    "nip": "nieprawidłowy NIP (cyfra kontrolna)",
    "regon": "nieprawidłowy REGON (cyfra kontrolna)",
    "iban": "nieprawidłowy numer konta (suma kontrolna)",
    "pesel": "nieprawidłowy PESEL",
}


def format_value(value: str, fmt: str | None, pattern: str | None) -> str:
    """Zwraca wartość w docelowym formacie albo rzuca MaskError z czytelnym opisem."""
    if not fmt:
        return value
    if fmt == "email":
        v = value.strip()
        if not _EMAIL.match(v):
            raise MaskError("nieprawidłowy adres e-mail")
        return v
    if fmt == "custom":
        mask = pattern or ""
        example = mask.replace("9", "0").replace("A", "X").replace("*", "X")
    else:
        mask = PRESETS[fmt]["mask"]
        example = mask.replace("9", "0").replace("A", "X")
    if fmt == "iban":
        value = re.sub(r"^\s*PL", "", value, flags=re.IGNORECASE)
    try:
        formatted = apply_mask(value, mask)
    except MaskError as exc:
        raise MaskError(f"oczekiwany format {example}") from exc
    check = _CHECKS.get(fmt)
    if check and not check("".join(c for c in formatted if c.isalnum())):
        raise MaskError(_CHECK_MSG[fmt])
    return formatted


# Domyślny format pola na podstawie nazwy znacznika (przy wgrywaniu szablonu).
_GUESS = [
    (re.compile(r"(^|_)(kod|kod_poczt\w*|zip|postal\w*)($|_)"), "postal"),
    (re.compile(r"(^|_)(tel|telefon|phone|kom|komorka)($|_)"), "phone"),
    (re.compile(r"(^|_)(e_?mail)($|_)"), "email"),
    (re.compile(r"(^|_)nip($|_)"), "nip"),
    (re.compile(r"(^|_)regon($|_)"), "regon"),
    (re.compile(r"(^|_)(iban|nr_konta|konto|rachunek)($|_)"), "iban"),
    (re.compile(r"(^|_)(nr_dowodu|dowod|dowod_osobisty)($|_)"), "id_card"),
]


def guess_format(key: str) -> str | None:
    k = key.lower()
    for rx, fmt in _GUESS:
        if rx.search(k):
            return fmt
    return None
