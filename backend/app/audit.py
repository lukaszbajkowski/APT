import ipaddress
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def client_ip(request: Request | None) -> str | None:
    if request is None:  # zadania automatyczne (cli)
        return None
    # Za Caddy uvicorn działa z --proxy-headers, więc request.client to już adres klienta.
    host = request.client.host if request.client else None
    if not host:
        return None
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None


def user_agent(request: Request | None) -> str | None:
    if request is None:
        return None
    ua = request.headers.get("user-agent")
    return ua[:400] if ua else None


def audit(
    db: Session,
    request: Request | None,
    action: str,
    *,
    user: User | None = None,
    username: str | None = None,
    entity_type: str | None = None,
    entity_id: str | int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Dopisuje zdarzenie do dziennika. Zapis następuje razem z commitem wywołującego."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=(user.username if user else username),
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            ip=client_ip(request),
            user_agent=user_agent(request),
            details=details,
        )
    )
