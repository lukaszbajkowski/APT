"""Język aplikacji i powiadomień pracownika.

Teksty są po polsku w kodzie; tłumaczy je Google (translate.py) przy pierwszym użyciu danego języka,
a wynik zostaje w tabeli `ui_translations` – kolejne osoby tego języka nie kosztują już ani znaku.
Fragmenty zmienne ({imie}, {dokument}) są chronione przed tłumaczeniem.
"""

import hashlib
import html
import re
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import translate
from app.audit import audit
from app.models import UiTranslation

LANG = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")
MAX_STRINGS = 150
MAX_LEN = 600
BATCH = 100
_VAR = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")
_SPAN = re.compile(r"</?span[^>]*>")


def valid_lang(code: str) -> bool:
    return bool(LANG.match(code)) and code.lower() not in ("pl", "pl-pl")


def key(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()  # noqa: S324 – skrót klucza pamięci, nie zabezpieczenie


def _protect(text: str) -> str:
    return _VAR.sub(lambda m: f'<span translate="no">{m.group(0)}</span>', html.escape(text, quote=False))


def _restore(text: str) -> str:
    return html.unescape(_SPAN.sub("", text))


def _fetch(texts: list[str], lang: str) -> list[str]:
    data = translate._call("", {"q": [_protect(t) for t in texts], "target": lang, "format": "html"})
    try:
        out = [_restore(x["translatedText"]) for x in data["data"]["translations"]]
    except (KeyError, TypeError) as exc:
        raise translate.TranslateError("Usługa tłumaczenia zwróciła nieoczekiwaną odpowiedź.") from exc
    if len(out) != len(texts):
        raise translate.TranslateError("Usługa tłumaczenia zwróciła nieoczekiwaną odpowiedź.")
    # zmienne muszą przetrwać tłumaczenie – inaczej zostaje polski oryginał
    return [
        o if sorted(_VAR.findall(o)) == sorted(_VAR.findall(t)) else t
        for t, o in zip(texts, out, strict=True)
    ]


def translate_many(db: Session, texts: Iterable[str], lang: str, request=None, user=None) -> dict[str, str]:
    """Zwraca {polski tekst: tłumaczenie}. Brakujące wpisy tłumaczy i zapisuje (z limitem miesięcznym)."""
    uniq = list(dict.fromkeys(t for t in texts if t and t.strip()))
    result: dict[str, str] = {}
    if not uniq:
        return result
    have = {
        r.source_hash: r.text
        for r in db.scalars(
            select(UiTranslation).where(
                UiTranslation.lang == lang, UiTranslation.source_hash.in_([key(t) for t in uniq])
            )
        )
    }
    missing = []
    for t in uniq:
        if key(t) in have:
            result[t] = have[key(t)]
        else:
            missing.append(t)
    if not missing or not translate.enabled():
        return result
    for i in range(0, len(missing), BATCH):
        chunk = missing[i : i + BATCH]
        chars = sum(len(t) for t in chunk)
        if translate.exhausted(db, chars):
            break
        done = _fetch(chunk, lang)
        for t, o in zip(chunk, done, strict=True):
            db.merge(UiTranslation(lang=lang, source_hash=key(t), text=o))
            result[t] = o
        audit(
            db,
            request,
            "ui_translated",
            user=user,
            details={"target": lang, "chars": chars, "count": len(chunk)},
        )
        db.commit()
    return result


def t(db: Session, text: str, lang: str | None, **vars: Any) -> str:
    """Tekst dla odbiorcy po stronie serwera (e-mail, push). Bez języka lub przy błędzie – polski."""
    out = text
    if lang and valid_lang(lang) and translate.enabled():
        try:
            out = translate_many(db, [text], lang).get(text, text)
        except Exception:  # noqa: BLE001 – powiadomienie ma wyjść nawet bez tłumacza
            out = text
    return out.format(**vars) if vars else out


def tr_email(db: Session | None, em: Any, lang: str | None, **vars: Any) -> Any:
    """E-mail z tekstami po polsku i polami {zmienna}: tłumaczy (gdy jest język) i podstawia wartości."""
    from dataclasses import replace

    def fmt(x: str) -> str:
        return x.format(**vars)

    fields = ["subject", "title", "preheader", "greeting", "notice", "footer_note"]
    texts = [getattr(em, f) for f in fields if getattr(em, f)] + list(em.paragraphs)
    if em.button:
        texts.append(em.button[0])
    tr: dict[str, str] = {}
    if db is not None and lang and valid_lang(lang) and translate.enabled():
        try:
            tr = translate_many(db, texts, lang)
        except Exception:  # noqa: BLE001 – wiadomość ma wyjść po polsku, jeśli tłumacz zawiedzie
            tr = {}

    def one(x: str | None) -> str | None:
        return fmt(tr.get(x, x)) if x else x

    changes = {f: one(getattr(em, f)) for f in fields}
    changes["paragraphs"] = [one(p) for p in em.paragraphs]
    if em.button:
        changes["button"] = (one(em.button[0]), em.button[1])
    return replace(em, **changes)
