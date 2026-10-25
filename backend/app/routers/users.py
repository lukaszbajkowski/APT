from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import mailer, notify, totp
from app.audit import audit
from app.deps import AdminAuth, DbSession, utcnow
from app.models import Agency, Department, Role, User, UserScope, UserSession
from app.schemas import (
    PasswordResetOut,
    ScopesIn,
    UserCreatedOut,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
)
from app.security import generate_temporary_password, hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono użytkownika.")
    return user


def _validate_scopes(db: Session, scopes: ScopesIn) -> None:
    agency_ids = set(scopes.agency_ids)
    department_ids = set(scopes.department_ids)
    if agency_ids:
        found = set(db.scalars(select(Agency.id).where(Agency.id.in_(agency_ids))))
        if found != agency_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Nieznane APT: {sorted(agency_ids - found)}",
            )
    if department_ids:
        found = set(db.scalars(select(Department.id).where(Department.id.in_(department_ids))))
        if found != department_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"Nieznane wydziały: {sorted(department_ids - found)}",
            )


def _set_scopes(user: User, scopes: ScopesIn | None) -> None:
    """Ustawia zakres kierownika. Liczy różnicę zamiast kasować wszystko, bo ORM
    wykonuje INSERT przed DELETE i ponowne dodanie tego samego wpisu złamałoby UNIQUE."""
    wanted: set[tuple[str, int]] = set()
    if user.role == Role.manager and scopes is not None:
        wanted |= {("agency", i) for i in scopes.agency_ids}
        wanted |= {("department", i) for i in scopes.department_ids}

    def key(s: UserScope) -> tuple[str, int]:
        return ("agency", s.agency_id) if s.agency_id is not None else ("department", s.department_id)  # type: ignore[return-value]

    existing = {key(s): s for s in user.scopes}
    for k, scope in existing.items():
        if k not in wanted:
            user.scopes.remove(scope)
    for kind, target_id in sorted(wanted - existing.keys()):
        if kind == "agency":
            user.scopes.append(UserScope(agency_id=target_id))
        else:
            user.scopes.append(UserScope(department_id=target_id))


def _scopes_snapshot(user: User) -> dict[str, list[int]]:
    return {
        "agency_ids": sorted(s.agency_id for s in user.scopes if s.agency_id is not None),
        "department_ids": sorted(s.department_id for s in user.scopes if s.department_id is not None),
    }


def _revoke_sessions(db: Session, user_id: int) -> None:
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def _active_admins(db: Session) -> int:
    return (
        db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin, User.is_active)) or 0
    )


@router.get("", response_model=list[UserOut])
def list_users(ctx: AdminAuth, db: DbSession) -> list[User]:
    return list(db.scalars(select(User).order_by(User.is_active.desc(), User.username)))


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, ctx: AdminAuth, db: DbSession) -> User:
    return _get_user(db, user_id)


@router.post("", response_model=UserCreatedOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreateIn, ctx: AdminAuth, request: Request, db: DbSession) -> UserCreatedOut:
    if db.scalar(select(User.id).where(User.username == body.username)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Taki login już istnieje.")
    _check_email_free(db, body.email, None)
    _validate_scopes(db, body.scopes)

    temporary_password = generate_temporary_password()
    user = User(
        username=body.username,
        full_name=body.full_name,
        email=body.email,
        role=body.role,
        password_hash=hash_password(temporary_password),
        is_active=True,
        must_change_password=True,
        failed_login_count=0,
    )
    _set_scopes(user, body.scopes)
    db.add(user)
    db.flush()
    audit(
        db,
        request,
        "user_created",
        user=ctx.user,
        entity_type="user",
        entity_id=user.id,
        details={
            "username": user.username,
            "role": user.role.value,
            "scopes": _scopes_snapshot(user),
        },
    )
    invite_token = None
    if body.send_invite and user.email and mailer.enabled():
        invite_token = notify.create_token(db, user, "invite", datetime.now(UTC))
    db.commit()
    db.refresh(user)
    if invite_token:
        notify.send_invite(user, invite_token)
    return UserCreatedOut(
        user=UserOut.model_validate(user),
        temporary_password=temporary_password,
        invite_sent=invite_token is not None,
    )


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdateIn, ctx: AdminAuth, request: Request, db: DbSession) -> User:
    user = _get_user(db, user_id)
    is_self = user.id == ctx.user.id
    changes: dict[str, object] = {}

    if body.role is not None and body.role != user.role:
        if is_self:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie możesz zmienić własnej roli.")
        if user.role == Role.admin and user.is_active and _active_admins(db) <= 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Musi zostać co najmniej jeden aktywny administrator."
            )
        changes["role"] = {"from": user.role.value, "to": body.role.value}
        user.role = body.role

    if body.is_active is not None and body.is_active != user.is_active:
        if is_self:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nie możesz wyłączyć własnego konta.")
        if not body.is_active and user.role == Role.admin and _active_admins(db) <= 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Musi zostać co najmniej jeden aktywny administrator."
            )
        changes["is_active"] = {"from": user.is_active, "to": body.is_active}
        user.is_active = body.is_active
        if not body.is_active:
            _revoke_sessions(db, user.id)

    if "email" in body.model_fields_set:
        new_email = body.email or None
        if new_email != user.email:
            _check_email_free(db, new_email, user.id)
            changes["email"] = {"from": user.email, "to": new_email}
            user.email = new_email

    if body.full_name is not None and body.full_name.strip() != user.full_name:
        changes["full_name"] = {"from": user.full_name, "to": body.full_name.strip()}
        user.full_name = body.full_name.strip()

    before_scopes = _scopes_snapshot(user)
    if body.scopes is not None:
        _validate_scopes(db, body.scopes)
        _set_scopes(user, body.scopes)
    elif user.role != Role.manager and user.scopes:
        _set_scopes(user, None)
    after_scopes = _scopes_snapshot(user)
    if after_scopes != before_scopes:
        changes["scopes"] = {"from": before_scopes, "to": after_scopes}

    if changes:
        audit(
            db,
            request,
            "user_updated",
            user=ctx.user,
            entity_type="user",
            entity_id=user.id,
            details=changes,
        )
    db.commit()
    db.refresh(user)
    return user


def _check_email_free(db: Session, email: str | None, user_id: int | None) -> None:
    if not email:
        return
    other = db.scalar(select(User.id).where(User.email == email))
    if other is not None and other != user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Ten adres e-mail ma już inne konto.")


@router.post("/{user_id}/send-password-link", status_code=status.HTTP_204_NO_CONTENT)
def send_password_link(user_id: int, ctx: AdminAuth, request: Request, db: DbSession) -> None:
    """E-mail z linkiem do ustawienia hasła (zamiast podawania hasła tymczasowego)."""
    user = _get_user(db, user_id)
    if not user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Użytkownik nie ma adresu e-mail.")
    if not mailer.enabled():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Wysyłka e-maili nie jest skonfigurowana.")
    token = notify.create_token(db, user, "invite", datetime.now(UTC))
    audit(db, request, "password_link_sent", user=ctx.user, entity_type="user", entity_id=user.id)
    db.commit()
    notify.send_invite(user, token)


@router.post("/{user_id}/reset-password", response_model=PasswordResetOut)
def reset_password(user_id: int, ctx: AdminAuth, request: Request, db: DbSession) -> PasswordResetOut:
    user = _get_user(db, user_id)
    temporary_password = generate_temporary_password()
    user.password_hash = hash_password(temporary_password)
    user.must_change_password = True
    user.failed_login_count = 0
    user.locked_until = None
    _revoke_sessions(db, user.id)
    audit(db, request, "password_reset", user=ctx.user, entity_type="user", entity_id=user.id)
    db.commit()
    return PasswordResetOut(temporary_password=temporary_password)


@router.post("/{user_id}/mfa-reset", response_model=UserOut)
def reset_mfa(user_id: int, ctx: AdminAuth, request: Request, db: DbSession) -> User:
    """Wyłącza 2FA użytkownika (np. zgubiony telefon). Dla Administratora i Kadr
    przy następnym logowaniu konfiguracja będzie wymagana ponownie."""
    user = _get_user(db, user_id)
    if user.id == ctx.user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Nie możesz zresetować własnego logowania dwuetapowego. Poproś innego administratora.",
        )
    if not user.mfa_enabled and user.totp_secret_enc is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Ten użytkownik nie ma włączonego 2FA.")
    totp.clear(user)
    _revoke_sessions(db, user.id)
    audit(db, request, "mfa_reset", user=ctx.user, entity_type="user", entity_id=user.id)
    db.commit()
    notify.security_notice(user, "administrator zresetował logowanie dwuetapowe")
    db.refresh(user)
    return user


@router.post("/{user_id}/unlock", response_model=UserOut)
def unlock_user(user_id: int, ctx: AdminAuth, request: Request, db: DbSession) -> User:
    user = _get_user(db, user_id)
    user.failed_login_count = 0
    user.locked_until = None
    audit(db, request, "user_unlocked", user=ctx.user, entity_type="user", entity_id=user.id)
    db.commit()
    db.refresh(user)
    return user
