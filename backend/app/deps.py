import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import get_db
from app.models import Role, User, UserSession
from app.security import token_hash

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

DbSession = Annotated[Session, Depends(get_db)]


def utcnow() -> datetime:
    return datetime.now(UTC)


class _SimScope:
    def __init__(self, agency_id: int | None, department_id: int | None) -> None:
        self.agency_id, self.department_id = agency_id, department_id


class SimulatedUser:
    """Administrator oglądający aplikację z uprawnieniami innej roli.

    Wszystko poza rolą i zakresem pochodzi z prawdziwego konta (id, nazwa – więc dziennik zdarzeń
    zapisuje działania administratora). Zmiany atrybutów trafiają do prawdziwego obiektu.
    """

    def __init__(self, real: User, role: Role, scopes: list[_SimScope], agency_id: int | None = None) -> None:
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "role", role)
        object.__setattr__(self, "scopes", scopes)
        object.__setattr__(self, "agency_id", agency_id)

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_real"), name)

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(object.__getattribute__(self, "_real"), name, value)


def simulated(user: User, sess: UserSession) -> Any:
    if user.role != Role.admin or not sess.sim_role:
        return user
    try:
        role = Role(sess.sim_role)
    except ValueError:
        return user
    scopes = []
    if role == Role.manager and sess.sim_department_id:
        scopes = [_SimScope(None, sess.sim_department_id)]
    return SimulatedUser(user, role, scopes, sess.sim_agency_id if role == Role.agency else None)


@dataclass
class AuthContext:
    user: User
    session: UserSession


def _unauthorized(detail: str = "Nie jesteś zalogowany.") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail)


def _expire(db: Session, request: Request, sess: UserSession, now: datetime, reason: str) -> None:
    """Zamyka wygasłą sesję i zapisuje automatyczne wylogowanie w dzienniku."""
    sess.revoked_at = now
    if not sess.mfa_pending:
        audit(db, request, "session_expired", user=sess.user, details={"reason": reason})
    db.commit()


def _load_session(request: Request, db: Session) -> AuthContext:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _unauthorized()

    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    now = utcnow()
    if sess is None or sess.revoked_at is not None:
        raise _unauthorized("Sesja wygasła. Zaloguj się ponownie.")
    if sess.expires_at <= now:
        _expire(db, request, sess, now, "max_time")
        raise _unauthorized("Sesja wygasła. Zaloguj się ponownie.")
    if sess.last_seen_at + timedelta(minutes=settings.session_idle_minutes) <= now:
        _expire(db, request, sess, now, "idle")
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

    return AuthContext(user=simulated(sess.user, sess), session=sess)


def get_auth_mfa_pending(request: Request, db: DbSession) -> AuthContext:
    """Sesja po poprawnym haśle, także czekająca jeszcze na kod logowania dwuetapowego."""
    return _load_session(request, db)


def get_auth_allow_password_change(request: Request, db: DbSession) -> AuthContext:
    """Zalogowany użytkownik, także taki, który musi jeszcze zmienić hasło lub włączyć 2FA."""
    ctx = _load_session(request, db)
    if ctx.session.mfa_pending:
        raise _unauthorized("Podaj kod z aplikacji uwierzytelniającej.")
    return ctx


def get_auth_allow_mfa_setup(request: Request, db: DbSession) -> AuthContext:
    """Zalogowany użytkownik z aktualnym hasłem, także bez wymaganego jeszcze 2FA."""
    ctx = get_auth_allow_password_change(request, db)
    if ctx.user.must_change_password:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required", "message": "Musisz zmienić hasło."},
        )
    return ctx


def get_auth(request: Request, db: DbSession) -> AuthContext:
    """W pełni zalogowany użytkownik: aktualne hasło i (jeśli wymagane) włączone 2FA."""
    ctx = get_auth_allow_mfa_setup(request, db)
    if ctx.user.mfa_required and not ctx.user.mfa_enabled:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "mfa_setup_required",
                "message": "Włącz logowanie dwuetapowe, aby kontynuować.",
            },
        )
    return ctx


Auth = Annotated[AuthContext, Depends(get_auth)]
AuthPwChange = Annotated[AuthContext, Depends(get_auth_allow_password_change)]
AuthMfaSetup = Annotated[AuthContext, Depends(get_auth_allow_mfa_setup)]
AuthMfaPending = Annotated[AuthContext, Depends(get_auth_mfa_pending)]


def require_roles(*roles: Role) -> Callable[[AuthContext], AuthContext]:
    def checker(ctx: Auth) -> AuthContext:
        if ctx.user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
        return ctx

    return checker


AdminAuth = Annotated[AuthContext, Depends(require_roles(Role.admin))]
StaffAuth = Annotated[AuthContext, Depends(require_roles(Role.admin, Role.hr))]
