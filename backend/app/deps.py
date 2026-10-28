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
EMPLOYEE_PATHS = ("/api/auth/", "/api/passkeys", "/api/me/", "/api/push/", "/api/translate/")

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


ACCOUNT_HEADER = "x-apt-account"
ACTIVE_COOKIE_SUFFIX = "_active"


def session_cookie(user_id: int) -> str:
    """Każde konto zalogowane w przeglądarce ma własne ciasteczko sesji (kilka kont naraz)."""
    return f"{get_settings().session_cookie_name}_{user_id}"


def _cookie_opts() -> dict[str, Any]:
    return {
        "httponly": True,
        "secure": get_settings().cookie_secure,
        "samesite": "strict",
        "path": "/api",
    }


def set_active_cookie(response: Any, user_id: int) -> None:
    """Domyślne konto dla żądań bez nagłówka (nowa karta, zwykłe linki do plików)."""
    response.set_cookie(
        get_settings().session_cookie_name + ACTIVE_COOKIE_SUFFIX, str(user_id), **_cookie_opts()
    )


def set_session_cookies(response: Any, user_id: int, token: str) -> None:
    response.set_cookie(session_cookie(user_id), token, **_cookie_opts())
    set_active_cookie(response, user_id)


def requested_account(request: Request) -> int | None:
    """Które konto obsługuje to żądanie: nagłówek (karta), ?acct= (obrazy, pliki) albo ostatnio aktywne."""
    raw = (
        request.headers.get(ACCOUNT_HEADER)
        or request.query_params.get("acct")
        or request.cookies.get(get_settings().session_cookie_name + ACTIVE_COOKIE_SUFFIX)
    )
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


def _load_session(request: Request, db: Session) -> AuthContext:
    settings = get_settings()
    account = requested_account(request)
    token = request.cookies.get(session_cookie(account)) if account is not None else None
    if not token:
        raise _unauthorized()

    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    now = utcnow()
    if sess is None or sess.revoked_at is not None or sess.user_id != account:
        raise _unauthorized("Sesja wygasła. Zaloguj się ponownie.")
    if sess.expires_at <= now:
        _expire(db, request, sess, now, "max_time")
        raise _unauthorized("Sesja wygasła. Zaloguj się ponownie.")
    if sess.last_seen_at + timedelta(minutes=settings.session_idle_minutes) <= now:
        _expire(db, request, sess, now, "idle")
        raise _unauthorized("Sesja wygasła z powodu bezczynności. Zaloguj się ponownie.")
    if not sess.user.is_active:
        raise _unauthorized("Konto jest wyłączone.")

    # Konto pracownika widzi wyłącznie swoje sprawy: logowanie, klucze dostępu i „Moje konto”.
    if sess.user.role == Role.employee and not request.url.path.startswith(EMPLOYEE_PATHS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")

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


def mfa_setup_pending(user: User, sess: UserSession) -> bool:
    """Czy trzeba jeszcze skonfigurować kod z aplikacji (admin, kadry)."""
    return user.mfa_required and not user.mfa_enabled


def get_auth(request: Request, db: DbSession) -> AuthContext:
    """W pełni zalogowany użytkownik: aktualne hasło i (jeśli wymagane) włączone 2FA."""
    ctx = get_auth_allow_mfa_setup(request, db)
    if mfa_setup_pending(ctx.user, ctx.session):
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
