from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select, update

from app.audit import audit, client_ip, user_agent
from app.config import get_settings
from app.deps import AuthPwChange, DbSession, utcnow
from app.models import User, UserSession
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


def _me(user: User, sess: UserSession) -> MeOut:
    return MeOut(
        user=UserOut.model_validate(user),
        csrf_token=sess.csrf_token,
        session_idle_minutes=get_settings().session_idle_minutes,
    )


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
            user.failed_login_count += 1
            details = {"failed_count": user.failed_login_count}
            if user.failed_login_count >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_login_count = 0
                details["locked"] = True
            audit(db, request, "login_failed", user=user, details=details)
        elif user is not None:
            audit(db, request, "login_failed", user=user, details={"reason": "inactive"})
        else:
            audit(db, request, "login_failed", username=username[:64], details={"reason": "unknown"})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    token = new_token()
    sess = UserSession(
        token_hash=token_hash(token),
        csrf_token=new_token(),
        user_id=user.id,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.session_max_hours),
        ip=client_ip(request),
        user_agent=user_agent(request),
    )
    db.add(sess)
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
def logout(ctx: AuthPwChange, request: Request, response: Response, db: DbSession) -> None:
    ctx.session.revoked_at = utcnow()
    audit(db, request, "logout", user=ctx.user)
    db.commit()
    response.delete_cookie(get_settings().session_cookie_name, path="/api")


@router.get("/me", response_model=MeOut)
def me(ctx: AuthPwChange) -> MeOut:
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
    return _me(user, ctx.session)
