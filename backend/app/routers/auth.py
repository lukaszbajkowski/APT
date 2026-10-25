from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import mailer, notify, totp
from app.audit import audit, client_ip, user_agent
from app.config import get_settings
from app.crypto import decrypt_secret, encrypt_secret
from app.deps import AuthMfaPending, AuthMfaSetup, AuthPwChange, DbSession, utcnow
from app.models import PasswordToken, User, UserSession
from app.schemas import ChangePasswordIn, LoginIn, MeOut, UserOut
from app.security import (
    hash_password,
    new_token,
    password_needs_rehash,
    password_problems,
    token_hash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_CREDENTIALS = "Nieprawidłowy login lub hasło."


# Sesja czekająca na kod 2FA wygasa szybko.
MFA_PENDING_MINUTES = 10


def _me(user: User, sess: UserSession) -> MeOut:
    return MeOut(
        user=UserOut.model_validate(user),
        csrf_token=sess.csrf_token,
        session_idle_minutes=get_settings().session_idle_minutes,
        mfa_pending=sess.mfa_pending,
        mfa_setup_required=user.mfa_required and not user.mfa_enabled,
        recovery_codes_left=user.recovery_codes_left,
    )


def _register_failure(db: Session, user: User, request: Request, action: str, **details: object) -> bool:
    """Liczy nieudaną próbę (hasło lub kod 2FA). Zwraca True, jeśli konto zostało zablokowane."""
    settings = get_settings()
    user.failed_login_count += 1
    info: dict[str, object] = {"failed_count": user.failed_login_count, **details}
    locked = False
    if user.failed_login_count >= settings.login_max_failures:
        user.locked_until = utcnow() + timedelta(minutes=settings.login_lock_minutes)
        user.failed_login_count = 0
        info["locked"] = True
        locked = True
        notify.security_notice(
            user,
            f"konto zablokowano na {settings.login_lock_minutes} min po kilku nieudanych próbach logowania",
        )
    audit(db, request, action, user=user, details=info)
    return locked


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, request: Request, response: Response, db: DbSession) -> MeOut:
    settings = get_settings()
    username = body.username.strip().lower()
    now = utcnow()

    user = db.scalar(select(User).where(User.username == username))

    if user is not None and user.locked_until is not None and user.locked_until > now:
        audit(db, request, "login_blocked", user=user)
        db.commit()
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise HTTPException(
            status.HTTP_423_LOCKED,
            detail=(
                "Konto jest tymczasowo zablokowane po zbyt wielu nieudanych próbach logowania. "
                f"Spróbuj ponownie za {minutes} min albo poproś administratora o odblokowanie."
            ),
        )

    password_ok = verify_password(user.password_hash if user else None, body.password)

    if user is None or not password_ok or not user.is_active:
        if user is not None and not password_ok:
            _register_failure(db, user, request, "login_failed")
        elif user is not None:
            audit(db, request, "login_failed", user=user, details={"reason": "inactive"})
        else:
            audit(db, request, "login_failed", username=username[:64], details={"reason": "unknown"})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    pending = user.mfa_enabled
    if not pending:
        user.failed_login_count = 0
        user.locked_until = None
        user.last_login_at = now

    token = new_token()
    sess = UserSession(
        token_hash=token_hash(token),
        csrf_token=new_token(),
        user_id=user.id,
        last_seen_at=now,
        expires_at=now
        + (
            timedelta(minutes=MFA_PENDING_MINUTES) if pending else timedelta(hours=settings.session_max_hours)
        ),
        ip=client_ip(request),
        user_agent=user_agent(request),
        mfa_pending=pending,
    )
    db.add(sess)
    if not pending:
        audit(db, request, "login", user=user)
    db.commit()

    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api",
    )
    return _me(user, sess)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    ctx: AuthMfaPending, request: Request, response: Response, db: DbSession, reason: str | None = None
) -> None:
    ctx.session.revoked_at = utcnow()
    audit(db, request, "logout", user=ctx.user, details={"reason": "idle"} if reason == "idle" else None)
    db.commit()
    response.delete_cookie(get_settings().session_cookie_name, path="/api")


@router.get("/me", response_model=MeOut)
def me(ctx: AuthMfaPending) -> MeOut:
    return _me(ctx.user, ctx.session)


@router.post("/change-password", response_model=MeOut)
def change_password(body: ChangePasswordIn, ctx: AuthPwChange, request: Request, db: DbSession) -> MeOut:
    user = ctx.user
    if not verify_password(user.password_hash, body.current_password):
        audit(db, request, "password_change_failed", user=user)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Obecne hasło jest nieprawidłowe.")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nowe hasło musi być inne niż obecne.")
    problems = password_problems(body.new_password, user.username)
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=" ".join(problems))

    now = utcnow()
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.password_changed_at = now
    # Wylogowujemy pozostałe sesje tego użytkownika.
    db.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user.id,
            UserSession.id != ctx.session.id,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    audit(db, request, "password_changed", user=user)
    db.commit()
    notify.security_notice(user, "zmieniono hasło")
    return _me(user, ctx.session)


# --- logowanie dwuetapowe ------------------------------------------------------


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class MfaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg: str


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]
    me: MeOut


class MfaDisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


def _check_totp(user: User, code: str) -> int | None:
    if user.totp_secret_enc is None:
        return None
    return totp.verify(decrypt_secret(user.totp_secret_enc), code, user.totp_last_step)


def _new_recovery_codes(user: User) -> list[str]:
    codes = totp.new_recovery_codes()
    user.recovery_codes = [totp.hash_recovery(c) for c in codes]
    return codes


@router.post("/mfa/verify", response_model=MeOut)
def mfa_verify(body: MfaCodeIn, ctx: AuthMfaPending, request: Request, db: DbSession) -> MeOut:
    """Drugi krok logowania: kod z aplikacji albo kod zapasowy."""
    user, sess = ctx.user, ctx.session
    if not sess.mfa_pending:
        return _me(user, sess)

    now = utcnow()
    if user.locked_until is not None and user.locked_until > now:
        raise HTTPException(status.HTTP_423_LOCKED, detail="Konto jest tymczasowo zablokowane.")

    method = None
    step = _check_totp(user, body.code)
    if step is not None:
        user.totp_last_step = step
        method = "totp"
    else:
        remaining = totp.use_recovery(user.recovery_codes or [], body.code)
        if remaining is not None:
            user.recovery_codes = remaining
            method = "recovery"

    if method is None:
        if _register_failure(db, user, request, "mfa_failed"):
            sess.revoked_at = now
            db.commit()
            raise HTTPException(
                status.HTTP_423_LOCKED,
                detail="Zbyt wiele błędnych kodów. Konto zostało tymczasowo zablokowane.",
            )
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy kod. Spróbuj ponownie.")

    settings = get_settings()
    sess.mfa_pending = False
    sess.expires_at = now + timedelta(hours=settings.session_max_hours)
    sess.last_seen_at = now
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    audit(db, request, "login", user=user, details={"mfa": method})
    if method == "recovery":
        audit(db, request, "mfa_recovery_used", user=user, details={"left": user.recovery_codes_left})
    db.commit()
    return _me(user, sess)


@router.post("/mfa/setup", response_model=MfaSetupOut)
def mfa_setup(ctx: AuthMfaSetup, db: DbSession) -> MfaSetupOut:
    """Nowy sekret do zeskanowania. Logowanie dwuetapowe włącza się dopiero po podaniu kodu."""
    user = ctx.user
    if user.mfa_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Logowanie dwuetapowe jest już włączone.")
    secret = totp.new_secret()
    user.totp_secret_enc = encrypt_secret(secret)
    user.totp_last_step = None
    db.commit()
    uri = totp.provisioning_uri(secret, user.username)
    return MfaSetupOut(secret=totp.secret_display(secret), otpauth_uri=uri, qr_svg=totp.qr_svg(uri))


@router.post("/mfa/enable", response_model=RecoveryCodesOut)
def mfa_enable(body: MfaCodeIn, ctx: AuthMfaSetup, request: Request, db: DbSession) -> RecoveryCodesOut:
    user = ctx.user
    if user.mfa_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Logowanie dwuetapowe jest już włączone.")
    if user.totp_secret_enc is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Najpierw wygeneruj kod QR.")
    step = _check_totp(user, body.code)
    if step is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Kod się nie zgadza. Sprawdź, czy zegar w telefonie jest ustawiony automatycznie.",
        )
    user.totp_last_step = step
    user.totp_enabled_at = utcnow()
    codes = _new_recovery_codes(user)
    audit(db, request, "mfa_enabled", user=user)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes, me=_me(user, ctx.session))


@router.post("/mfa/recovery-codes", response_model=RecoveryCodesOut)
def mfa_new_recovery_codes(
    body: MfaCodeIn, ctx: AuthMfaSetup, request: Request, db: DbSession
) -> RecoveryCodesOut:
    """Nowe kody zapasowe (stare przestają działać). Wymaga aktualnego kodu z aplikacji."""
    user = ctx.user
    if not user.mfa_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Logowanie dwuetapowe nie jest włączone.")
    step = _check_totp(user, body.code)
    if step is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy kod z aplikacji.")
    user.totp_last_step = step
    codes = _new_recovery_codes(user)
    audit(db, request, "mfa_recovery_regenerated", user=user)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes, me=_me(user, ctx.session))


@router.post("/mfa/disable", response_model=MeOut)
def mfa_disable(body: MfaDisableIn, ctx: AuthMfaSetup, request: Request, db: DbSession) -> MeOut:
    user = ctx.user
    if user.mfa_required:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Dla Twojej roli logowanie dwuetapowe jest obowiązkowe.",
        )
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowe hasło.")
    totp.clear(user)
    audit(db, request, "mfa_disabled", user=user)
    db.commit()
    notify.security_notice(user, "wyłączono logowanie dwuetapowe")
    return _me(user, ctx.session)


# --- reset hasła e-mailem ------------------------------------------------------

RESET_LIMIT_PER_HOUR = 3


class ResetRequestIn(BaseModel):
    login: str = Field(min_length=1, max_length=254)


class ResetConfirmIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=1, max_length=256)


class ResetCheckOut(BaseModel):
    valid: bool
    username: str | None = None
    purpose: str | None = None


class AuthConfigOut(BaseModel):
    password_reset: bool


@router.get("/config", response_model=AuthConfigOut)
def auth_config() -> AuthConfigOut:
    return AuthConfigOut(password_reset=mailer.enabled())


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
def password_reset_request(body: ResetRequestIn, request: Request, db: DbSession) -> dict[str, str]:
    """Zawsze ta sama odpowiedź – nie zdradzamy, czy login / e-mail istnieje."""
    ok = {"message": "Jeśli konto istnieje i ma adres e-mail, wysłaliśmy link do ustawienia nowego hasła."}
    if not mailer.enabled():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Reset hasła e-mailem nie jest włączony.")
    value = body.login.strip().lower()
    user = db.scalar(select(User).where((User.username == value) | (User.email == value)))
    if user is None or not user.is_active or not user.email:
        audit(db, request, "password_reset_requested", username=value[:64], details={"sent": False})
        db.commit()
        return ok
    now = utcnow()
    recent = db.scalar(
        select(func.count())
        .select_from(PasswordToken)
        .where(PasswordToken.user_id == user.id, PasswordToken.created_at >= now - timedelta(hours=1))
    )
    if (recent or 0) >= RESET_LIMIT_PER_HOUR:
        audit(
            db, request, "password_reset_requested", user=user, details={"sent": False, "rate_limited": True}
        )
        db.commit()
        return ok
    token = notify.create_token(db, user, "reset", now)
    audit(db, request, "password_reset_requested", user=user, details={"sent": True})
    db.commit()
    notify.send_reset(user, token)
    return ok


@router.get("/password-reset/check", response_model=ResetCheckOut)
def password_reset_check(token: str, db: DbSession) -> ResetCheckOut:
    t = notify.find_token(db, token, utcnow())
    if t is None:
        return ResetCheckOut(valid=False)
    return ResetCheckOut(valid=True, username=t.user.username, purpose=t.purpose)


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_confirm(body: ResetConfirmIn, request: Request, db: DbSession) -> None:
    now = utcnow()
    t = notify.find_token(db, body.token, now)
    if t is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Link wygasł albo został już użyty. Poproś o nowy.",
        )
    user = t.user
    problems = password_problems(body.new_password, user.username)
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=" ".join(problems))
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.password_changed_at = now
    user.failed_login_count = 0
    user.locked_until = None
    t.used_at = now
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    audit(db, request, "password_set_by_link", user=user, details={"purpose": t.purpose})
    db.commit()
    notify.security_notice(user, "ustawiono nowe hasło przez link z e-maila")
