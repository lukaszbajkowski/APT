import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Role, User, UserSession
from app.security import token_hash

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

DbSession = Annotated[Session, Depends(get_db)]


def utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass
class AuthContext:
    user: User
    session: UserSession


def _unauthorized(detail: str = "Nie jesteś zalogowany.") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail)


def _load_session(request: Request, db: Session) -> AuthContext:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _unauthorized()

    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    now = utcnow()
    if sess is None or sess.revoked_at is not None or sess.expires_at <= now:
        raise _unauthorized("Sesja wygasła. Zaloguj się ponownie.")
    if sess.last_seen_at + timedelta(minutes=settings.session_idle_minutes) <= now:
        sess.revoked_at = now
        db.commit()
        raise _unauthorized("Sesja wygasła z powodu bezczynności. Zaloguj się ponownie.")
    if not sess.user.is_active:
        raise _unauthorized("Konto jest wyłączone.")

    # CSRF: dla metod zmieniających dane wymagamy nagłówka zgodnego z tokenem sesji.
    if request.method not in SAFE_METHODS:
        sent = request.headers.get(settings.csrf_header_name, "")
        if not secrets.compare_digest(sent, sess.csrf_token):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Nieprawidłowy token CSRF.")

    # Odświeżamy "ostatnio widziano" najwyżej raz na minutę, żeby nie pisać przy każdym żądaniu.
    if now - sess.last_seen_at > timedelta(seconds=60):
        sess.last_seen_at = now
        db.commit()

    return AuthContext(user=sess.user, session=sess)


def get_auth_allow_password_change(request: Request, db: DbSession) -> AuthContext:
    """Zalogowany użytkownik, także taki, który musi jeszcze zmienić hasło."""
    return _load_session(request, db)


def get_auth(request: Request, db: DbSession) -> AuthContext:
    """Zalogowany użytkownik z aktualnym hasłem."""
    ctx = _load_session(request, db)
    if ctx.user.must_change_password:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required", "message": "Musisz zmienić hasło."},
        )
    return ctx


Auth = Annotated[AuthContext, Depends(get_auth)]
AuthPwChange = Annotated[AuthContext, Depends(get_auth_allow_password_change)]


def require_roles(*roles: Role) -> Callable[[AuthContext], AuthContext]:
    def checker(ctx: Auth) -> AuthContext:
        if ctx.user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
        return ctx

    return checker


AdminAuth = Annotated[AuthContext, Depends(require_roles(Role.admin))]
