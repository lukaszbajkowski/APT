"""Okres przechowywania danych zwolnionych pracowników."""

from datetime import date

from app.config import get_settings
from app.models import Employee, EmployeeStatus


def retention_end(termination_date: date | None) -> date | None:
    """Ostatni dzień przechowywania: koniec roku zwolnienia + N lat (np. 2026 -> 31.12.2036)."""
    if termination_date is None:
        return None
    return date(termination_date.year + get_settings().retention_years, 12, 31)


def delete_after(e: Employee) -> date | None:
    """Dzień, po którym dane można usunąć (z uwzględnieniem wstrzymania). None – nie dotyczy."""
    if e.status != EmployeeStatus.terminated:
        return None
    end = retention_end(e.termination_date)
    if end is None:
        return None
    if e.retention_hold_until and e.retention_hold_until > end:
        return e.retention_hold_until
    return end


def is_due(e: Employee, today: date | None = None) -> bool:
    after = delete_after(e)
    return after is not None and (today or date.today()) > after
