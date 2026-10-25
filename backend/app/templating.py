"""Szablony dokumentów .docx (docxtpl / Jinja2) i konwersja do PDF.

Znaczniki w Wordzie: {{ nazwa }}, {% if … %}…{% endif %}, {{ '☒' if wariant == 'rodzinny' else '☐' }}.
Zmienne dzielą się na:
- wbudowane – wypełniane z kartoteki (BUILTINS),
- pola formularza – o które aplikacja pyta przed wygenerowaniem (definicje w szablonie).
"""

import io
import os
import re
import shutil
import subprocess
import tempfile
import threading
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

from docxtpl import DocxTemplate
from jinja2 import Environment, TemplateSyntaxError, nodes
from pydantic import BaseModel, Field, field_validator, model_validator

# ---------- zmienne z kartoteki ----------

BUILTINS: dict[str, str] = {
    "imie": "Imię",
    "nazwisko": "Nazwisko",
    "nazwisko_imie": "Nazwisko i imię",
    "imie_nazwisko": "Imię i nazwisko",
    "numer": "Numer ewidencyjny",
    "pesel": "PESEL",
    "data_urodzenia": "Data urodzenia (dd.mm.rrrr)",
    "plec": "Płeć (kobieta / mężczyzna)",
    "plec_kod": "Płeć (K / M)",
    "obywatelstwo": "Obywatelstwo (nazwa kraju)",
    "apt": "APT (agencja)",
    "wydzial": "Wydział",
    "stanowisko": "Stanowisko",
    "data_zatrudnienia": "Data zatrudnienia",
    "data_dzisiaj": "Dzisiejsza data",
    # wypełniane tylko przy dokumencie generowanym ze szkolenia (inaczej puste)
    "szkolenie_rodzaj": "Szkolenie: rodzaj",
    "szkolenie_nazwa": "Szkolenie: nazwa",
    "szkolenie_wydzial": "Szkolenie: wydział",
    "szkolenie_data_rozpoczecia": "Szkolenie: data rozpoczęcia",
    "szkolenie_data_egzaminu": "Szkolenie: data egzaminu",
    "szkolenie_data_zakonczenia": "Szkolenie: data zakończenia",
    "szkolenie_data_ukonczenia": "Szkolenie: data ukończenia",
    "szkolenie_wazne_do": "Szkolenie: ważne do",
    "szkolenie_opiekun": "Szkolenie: opiekun (imię i nazwisko)",
    "szkolenie_czas_dni": "Szkolenie: czas nauki wg standardu (dni)",
    "szkolenie_uwagi": "Szkolenie: uwagi",
}
# Zmienne z danymi wrażliwymi – szablonów z nimi nie może używać Kierownik.
SENSITIVE = {"pesel", "data_urodzenia"}


def _d(v: date | None) -> str:
    return v.strftime("%d.%m.%Y") if v else ""


def training_values(tr: Any | None) -> dict[str, str]:
    """Zmienne szkolenie_* (puste, gdy dokument nie jest generowany ze szkolenia)."""
    if tr is None:
        return {k: "" for k in BUILTINS if k.startswith("szkolenie_")}
    m = tr.mentor
    return {
        "szkolenie_rodzaj": tr.type.name,
        "szkolenie_nazwa": tr.name or tr.type.name,
        "szkolenie_wydzial": tr.department.name if tr.department else "",
        "szkolenie_data_rozpoczecia": _d(tr.start_date),
        "szkolenie_data_egzaminu": _d(tr.exam_date),
        "szkolenie_data_zakonczenia": _d(tr.end_date),
        "szkolenie_data_ukonczenia": _d(tr.completed_on),
        "szkolenie_wazne_do": _d(tr.valid_until),
        "szkolenie_opiekun": f"{m.first_name} {m.last_name}" if m else "",
        "szkolenie_czas_dni": str(tr.standard_days) if tr.standard_days is not None else "",
        "szkolenie_uwagi": tr.notes or "",
    }


def builtin_values(
    e: Any, pesel: str | None, today: date | None = None, training: Any = None
) -> dict[str, str]:
    today = today or date.today()
    d = _d

    sex = e.sex.value if e.sex else None
    return {
        "imie": e.first_name,
        "nazwisko": e.last_name,
        "nazwisko_imie": f"{e.last_name} {e.first_name}",
        "imie_nazwisko": f"{e.first_name} {e.last_name}",
        "numer": f"{e.number:06d}",
        "pesel": pesel or "",
        "data_urodzenia": d(e.birth_date),
        "plec": {"K": "kobieta", "M": "mężczyzna"}.get(sex or "", ""),
        "plec_kod": sex or "",
        "obywatelstwo": e.country.name if e.country else "",
        "apt": e.agency.name if e.agency else "",
        "wydzial": e.department.name if e.department else "",
        "stanowisko": e.position.name if e.position else "",
        "data_zatrudnienia": d(e.hire_date),
        "data_dzisiaj": d(today),
    } | training_values(training)


# ---------- definicje pól formularza ----------

FieldType = Literal["text", "textarea", "date", "select", "checkbox", "number"]


class FieldOption(BaseModel):
    value: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)


from app.masks import MaskError, format_value, guess_format  # noqa: E402


class FieldDef(BaseModel):
    key: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$", max_length=64)
    label: str = Field(min_length=1, max_length=200)
    type: FieldType = "text"
    required: bool = False
    options: list[FieldOption] = Field(default_factory=list)
    help: str | None = Field(default=None, max_length=300)
    # format pola tekstowego: klucz z masks.PRESETS albo "custom" (wtedy pattern = maska, np. "99-999")
    format: str | None = Field(default=None, max_length=20)
    pattern: str | None = Field(default=None, max_length=60)

    @field_validator("format")
    @classmethod
    def _fmt(cls, v: str | None) -> str | None:
        from app.masks import PRESETS

        if v in (None, ""):
            return None
        if v != "custom" and v not in PRESETS:
            raise ValueError("Nieznany format pola.")
        return v

    @model_validator(mode="after")
    def _custom_needs_pattern(self) -> "FieldDef":
        from app.masks import valid_pattern

        if self.format == "custom" and not valid_pattern(self.pattern or ""):
            raise ValueError(f"Pole „{self.label}”: podaj wzór maski, np. 99-999 (9 = cyfra, A = litera).")
        if self.format != "custom":
            self.pattern = None
        return self


# Podpowiedzi etykiet dla typowych nazw (np. z deklaracji Medicover). Admin może je zmienić.
_KNOWN_LABELS = {
    "email": "E-mail",
    "e_mail": "E-mail",
    "telefon": "Telefon",
    "tel_dom": "Telefon domowy",
    "tel_kom": "Telefon komórkowy",
    "program": "Program",
    "wariant": "Wariant",
    "deklaracja_typ": "Rodzaj deklaracji",
    "nr_karty_medicover": "Numer karty Medicover (jeśli już istnieje)",
    "zam_miasto": "Adres zamieszkania – miasto",
    "zam_kod": "Adres zamieszkania – kod pocztowy",
    "zam_ulica": "Adres zamieszkania – ulica",
    "zam_nr": "Adres zamieszkania – nr domu/mieszkania",
    "kor_miasto": "Adres korespondencyjny – miasto",
    "kor_kod": "Adres korespondencyjny – kod pocztowy",
    "kor_ulica": "Adres korespondencyjny – ulica",
    "kor_nr": "Adres korespondencyjny – nr domu/mieszkania",
    "data_od": "Data od",
    "data_do": "Data do",
    "uwagi": "Uwagi",
}
_KNOWN_OPTION_LABELS = {
    "przystapienie": "przystąpienie",
    "odstapienie": "odstąpienie",
    "zmiana": "zmiana programu",
    "pojedynczy": "pojedynczy",
    "partnerski": "partnerski",
    "rodzinny": "rodzinny",
}


def humanize(key: str) -> str:
    if key in _KNOWN_LABELS:
        return _KNOWN_LABELS[key]
    text = key.replace("_", " ").strip()
    return text[:1].upper() + text[1:]


# ---------- analiza szablonu ----------


class TemplateError(ValueError):
    pass


@dataclass
class Analysis:
    variables: list[str]  # wszystkie zmienne użyte w szablonie
    builtins: list[str]  # z tego wbudowane
    fields: list[FieldDef]  # proponowane pola formularza (zmienne spoza kartoteki)

    @property
    def sensitive(self) -> bool:
        return bool(SENSITIVE & set(self.builtins))


def _jinja_sources(tpl: DocxTemplate) -> list[str]:
    tpl.init_docx()
    sources = [tpl.patch_xml(tpl.get_xml())]
    for part in [*tpl.get_headers_footers(tpl.HEADER_URI), *tpl.get_headers_footers(tpl.FOOTER_URI)]:
        sources.append(tpl.patch_xml(tpl.get_part_xml(part[1])))
    return sources


def _comparisons(ast: nodes.Node) -> dict[str, list[str]]:
    """Szuka porównań `zmienna == 'wartość'` – z nich powstają listy wyboru."""
    found: dict[str, list[str]] = {}
    for cmp in ast.find_all(nodes.Compare):
        if not isinstance(cmp.expr, nodes.Name) or len(cmp.ops) != 1:
            continue
        op = cmp.ops[0]
        if op.op in ("eq", "ne") and isinstance(op.expr, nodes.Const) and isinstance(op.expr.value, str):
            values = found.setdefault(cmp.expr.name, [])
            if op.expr.value not in values:
                values.append(op.expr.value)
    return found


def _ordered_names(source: str) -> list[str]:
    """Nazwy zmiennych w kolejności pierwszego wystąpienia w dokumencie (kolejność pól w formularzu)."""
    names: list[str] = []
    for m in re.finditer(r"\{[{%](.*?)[%}]\}", source, re.S):
        for name in re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\b", m.group(1)):
            if name not in names:
                names.append(name)
    return names


def analyze(data: bytes) -> Analysis:
    try:
        tpl = DocxTemplate(io.BytesIO(data))
        sources = _jinja_sources(tpl)
        variables = set(tpl.get_undeclared_template_variables())
    except TemplateSyntaxError as exc:
        raise TemplateError(_syntax_message(exc)) from exc
    except Exception as exc:  # uszkodzony plik, nie-docx
        raise TemplateError(
            "Nie udało się odczytać pliku. Szablon musi być dokumentem Word (.docx)."
        ) from exc

    env = Environment()
    options: dict[str, list[str]] = {}
    order: list[str] = []
    for src in sources:
        try:
            ast = env.parse(src)
        except TemplateSyntaxError as exc:
            raise TemplateError(_syntax_message(exc)) from exc
        for k, v in _comparisons(ast).items():
            options.setdefault(k, [])
            options[k] += [x for x in v if x not in options[k]]
        order += [n for n in _ordered_names(src) if n not in order]

    ordered = [n for n in order if n in variables] + sorted(variables - set(order))
    builtins = [v for v in ordered if v in BUILTINS]
    fields = []
    for key in ordered:
        if key in BUILTINS:
            continue
        if key in options:
            fields.append(
                FieldDef(
                    key=key,
                    label=humanize(key),
                    type="select",
                    options=[
                        FieldOption(value=o, label=_KNOWN_OPTION_LABELS.get(o, o)) for o in options[key]
                    ],
                )
            )
        else:
            ftype: FieldType = "date" if key.startswith("data_") else "text"
            fields.append(
                FieldDef(
                    key=key,
                    label=humanize(key),
                    type=ftype,
                    format=guess_format(key) if ftype == "text" else None,
                )
            )
    return Analysis(variables=ordered, builtins=builtins, fields=fields)


def _syntax_message(exc: TemplateSyntaxError) -> str:
    msg = (
        "Błąd w znacznikach szablonu: sprawdź nawiasy {{ }} i {% %}. "
        "Częsta przyczyna: Word zamienił proste cudzysłowy ' na „ ” – wyłącz autokorektę cudzysłowów."
    )
    return f"{msg} (szczegóły: {exc.message})"


def merge_fields(existing: list[FieldDef], detected: list[FieldDef]) -> list[FieldDef]:
    """Po podmianie pliku: zachowaj ustawienia pól, które dalej występują; dodaj nowe; usuń zbędne."""
    by_key = {f.key: f for f in existing}
    return [by_key.get(f.key, f) for f in detected]


# ---------- wypełnianie ----------


def form_values(fields: list[FieldDef], raw: dict[str, Any]) -> dict[str, Any]:
    """Sprawdza wartości z formularza i zamienia je na postać dla szablonu."""
    out: dict[str, Any] = {}
    errors: list[str] = []
    for f in fields:
        v = raw.get(f.key)
        if isinstance(v, str):
            v = v.strip()
        empty = v is None or v == "" or (f.type == "checkbox" and v is False)
        if empty:
            if f.required:
                errors.append(f"Pole „{f.label}” jest wymagane.")
            out[f.key] = False if f.type == "checkbox" else ""
            continue
        if f.type == "checkbox":
            out[f.key] = bool(v)
        elif f.type == "select":
            allowed = {o.value for o in f.options}
            if str(v) not in allowed:
                errors.append(f"Pole „{f.label}”: niedozwolona wartość.")
            out[f.key] = str(v)
        elif f.type == "date":
            try:
                out[f.key] = date.fromisoformat(str(v)).strftime("%d.%m.%Y")
            except ValueError:
                errors.append(f"Pole „{f.label}”: nieprawidłowa data.")
        elif f.type == "number":
            try:
                n = float(str(v).replace(",", "."))
                out[f.key] = int(n) if n.is_integer() else n
            except ValueError:
                errors.append(f"Pole „{f.label}”: to nie jest liczba.")
        elif f.type == "text" and f.format:
            try:
                out[f.key] = format_value(str(v), f.format, f.pattern)
            except MaskError as exc:
                errors.append(f"Pole „{f.label}”: {exc}.")
        else:
            out[f.key] = str(v)[:2000]
    if errors:
        raise TemplateError(" ".join(errors))
    return out


def render_docx(template: bytes, context: dict[str, Any]) -> bytes:
    tpl = DocxTemplate(io.BytesIO(template))
    try:
        tpl.render(context, autoescape=True)
    except TemplateSyntaxError as exc:
        raise TemplateError(_syntax_message(exc)) from exc
    except Exception as exc:
        raise TemplateError(f"Nie udało się wypełnić szablonu: {exc}") from exc
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue()


# ---------- PDF przez LibreOffice ----------

_soffice_lock = threading.Lock()


class PdfUnavailable(RuntimeError):
    pass


def soffice_path() -> str | None:
    return shutil.which("soffice") or shutil.which("libreoffice")


def to_pdf(docx: bytes, timeout: int = 90) -> bytes:
    exe = soffice_path()
    if not exe:
        raise PdfUnavailable("Na serwerze nie ma LibreOffice – PDF jest niedostępny, pobierz plik Word.")
    # LibreOffice nie lubi równoległych wywołań na jednym profilu – osobny profil i blokada.
    with _soffice_lock, tempfile.TemporaryDirectory(prefix="apt-pdf-") as tmp:
        src = Path(tmp) / "dokument.docx"
        src.write_bytes(docx)
        profile = Path(tmp) / "profile"
        cmd = [
            exe,
            f"-env:UserInstallation=file://{profile}",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            tmp,
            str(src),
        ]
        try:
            subprocess.run(
                cmd, check=True, timeout=timeout, capture_output=True, env={**os.environ, "HOME": tmp}
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise PdfUnavailable("Konwersja do PDF nie powiodła się. Pobierz plik Word.") from exc
        out = Path(tmp) / "dokument.pdf"
        if not out.exists():
            raise PdfUnavailable("Konwersja do PDF nie powiodła się. Pobierz plik Word.")
        return out.read_bytes()


def safe_filename(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).replace("ł", "l").replace("Ł", "L")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("_")
    return text[:80] or "dokument"
