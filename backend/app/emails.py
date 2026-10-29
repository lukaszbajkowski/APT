# ruff: noqa: E501  (szablony HTML – długie linie stylów są czytelniejsze w całości)
"""Szablony e-maili w szacie graficznej aplikacji (HTML + wersja tekstowa).

HTML jest pisany „po mailowemu”: tabele i style w atrybutach, bo programy pocztowe
(Outlook, Gmail) ignorują arkusze stylów i nowoczesny CSS.
"""

from dataclasses import dataclass, field
from html import escape
from typing import Literal

APP_NAME = "Identyfikacja pracowników APT"

# Kolory z motywu aplikacji (frontend/src/main.tsx, paleta „navy”)
NAVY_DARK = "#1f3a73"
NAVY = "#3657a8"
NAVY_LIGHT = "#eef2fa"
TEXT = "#1f2937"
MUTED = "#6b7280"
BORDER = "#dbe2f0"
PAGE_BG = "#f4f6fb"
TONES = {
    "info": ("#3657a8", "#eef2fa"),
    "success": ("#2f9e44", "#ebfbee"),
    "warning": ("#e8590c", "#fff4e6"),
    "danger": ("#c92a2a", "#fff5f5"),
}
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

Tone = Literal["info", "success", "warning", "danger"]


@dataclass
class Email:
    subject: str
    title: str
    greeting: str | None = None
    paragraphs: list[str] = field(default_factory=list)
    button: tuple[str, str] | None = None  # (etykieta, adres)
    details: list[tuple[str, str]] = field(default_factory=list)  # tabelka klucz – wartość
    items: list[str] = field(default_factory=list)  # lista punktowana
    notice: str | None = None  # ramka z ostrzeżeniem / informacją
    tone: Tone = "info"
    footer_note: str | None = None
    preheader: str | None = None  # podgląd w skrzynce (pod tematem)
    attachments: list[tuple[str, bytes, str]] = field(default_factory=list)  # (nazwa, dane, typ MIME)
    # stałe teksty szablonu – po polsku, tłumaczone razem z resztą (i18n.tr_email)
    link_hint: str = "Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:"
    auto_note: str = "Wiadomość wysłana automatycznie. Nie odpowiadaj na nią."

    # --- wersja tekstowa ---------------------------------------------------------

    def text(self) -> str:
        lines: list[str] = []
        if self.greeting:
            lines += [self.greeting, ""]
        for p in self.paragraphs:
            lines += [p, ""]
        for k, v in self.details:
            lines.append(f"{k}: {v}")
        if self.details:
            lines.append("")
        for it in self.items:
            lines.append(f"• {it}")
        if self.items:
            lines.append("")
        if self.button:
            lines += [f"{self.button[0]}:", self.button[1], ""]
        if self.notice:
            lines += [self.notice, ""]
        if self.footer_note:
            lines += [self.footer_note, ""]
        lines += ["—", APP_NAME, self.auto_note]
        return "\n".join(lines)

    # --- wersja HTML ---------------------------------------------------------------

    def html(self) -> str:
        accent, accent_bg = TONES[self.tone]
        e = escape
        body: list[str] = []

        body.append(
            f'<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:700;color:{NAVY_DARK};">'
            f"{e(self.title)}</h1>"
        )
        if self.greeting:
            body.append(_p(e(self.greeting)))
        for para in self.paragraphs:
            body.append(_p(e(para)))

        if self.details:
            rows = "".join(
                f'<tr><td style="padding:8px 12px;border-bottom:1px solid {BORDER};color:{MUTED};'
                f'font-size:13px;white-space:nowrap;vertical-align:top;">{e(k)}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid {BORDER};color:{TEXT};font-size:14px;'
                f'font-weight:600;">{e(v)}</td></tr>'
                for k, v in self.details
            )
            body.append(
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                f'style="border-collapse:collapse;margin:4px 0 20px;border:1px solid {BORDER};'
                f'border-radius:6px;">{rows}</table>'
            )

        if self.items:
            lis = "".join(
                f'<li style="margin:0 0 8px;font-size:15px;line-height:1.5;color:{TEXT};">{e(it)}</li>'
                for it in self.items
            )
            body.append(f'<ul style="margin:0 0 20px;padding-left:20px;">{lis}</ul>')

        if self.button:
            label, url = self.button
            body.append(
                '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">'
                f'<tr><td style="border-radius:6px;background:{NAVY};">'
                f'<a href="{e(url, quote=True)}" target="_blank" style="display:inline-block;padding:12px 26px;'
                f"font-family:{FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;"
                f'border-radius:6px;">{e(label)}</a></td></tr></table>'
            )
            body.append(
                f'<p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:{MUTED};">'
                f"{e(self.link_hint)}<br>"
                f'<a href="{e(url, quote=True)}" style="color:{NAVY};word-break:break-all;">{e(url)}</a></p>'
            )

        if self.notice:
            body.append(
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">'
                f'<tr><td style="background:{accent_bg};border-left:4px solid {accent};border-radius:4px;'
                f'padding:12px 14px;font-size:14px;line-height:1.5;color:{TEXT};">{e(self.notice)}</td></tr></table>'
            )
        if self.footer_note:
            body.append(
                f'<p style="margin:0;font-size:13px;line-height:1.5;color:{MUTED};">{e(self.footer_note)}</p>'
            )

        preheader = e(self.preheader or self.title)
        return f"""<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{e(self.subject)}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE_BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE_BG};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:560px;background:#ffffff;border:1px solid {BORDER};border-radius:10px;overflow:hidden;font-family:{FONT};">
<tr><td style="background:{NAVY_DARK};padding:18px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:{FONT};font-size:16px;font-weight:700;color:#ffffff;">{APP_NAME}</td>
<td align="right" style="font-family:{FONT};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#b3c2e2;">
{e(_host())}</td>
</tr></table>
</td></tr>
<tr><td style="height:4px;background:{accent};line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 24px;">
{"".join(body)}
</td></tr>
<tr><td style="background:{NAVY_LIGHT};padding:14px 28px;font-size:12px;line-height:1.5;color:{MUTED};">
{APP_NAME}. {e(self.auto_note)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _host() -> str:
    from urllib.parse import urlparse

    from app.config import get_settings

    return urlparse(get_settings().public_url).hostname or ""


def _p(content: str) -> str:
    return f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{TEXT};">{content}</p>'
