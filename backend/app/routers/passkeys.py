"""Klucze dostępu (WebAuthn): logowanie bez hasła, zaproszenia dla pracowników i „Moje konto”.

Pracownik dostaje od kadr zaproszenie, potwierdza datą urodzenia i rejestruje klucz dostępu
(Face ID / odcisk palca / PIN telefonu) albo – jako zapas – ustawia hasło (wtedy obowiązuje kod z aplikacji).
"""

import json
import os
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app import mailer, notify, totp
from app.audit import audit, client_ip, user_agent
from app.config import get_settings
from app.deps import Auth, DbSession, StaffAuth, utcnow
from app.device import _b64, _unb64, rp_and_origin
from app.emails import Email
from app.models import (
    NO_PASSWORD,
    Employee,
    PasswordToken,
    Role,
    User,
    UserSession,
    WebauthnChallenge,
    WebauthnCredential,
)
from app.routers.auth import MFA_PENDING_MINUTES, _check_totp, _me, _register_failure
from app.schemas import MeOut
from app.security import hash_password, new_token, password_problems, token_hash, verify_password

router = APIRouter(prefix="/api", tags=["passkeys"])

CHALLENGE_MINUTES = 5
INVITE_PURPOSE = "empinvite"
INVITE_DAYS = 7
_ERR = "Nie udało się potwierdzić kluczem dostępu. Spróbuj jeszcze raz."


# --- pomocnicze ------------------------------------------------------------------


def _store_challenge(db: Session, challenge: bytes, purpose: str, user: User | None) -> str:
    cid = new_token()[:40]
    now = utcnow()
    db.add(
        WebauthnChallenge(
            id=cid,
            challenge=_b64(challenge),
            purpose=purpose,
            user_id=user.id if user else None,
            expires_at=now + timedelta(minutes=CHALLENGE_MINUTES),
        )
    )
    return cid


def _take_challenge(db: Session, cid: str, purpose: str, user: User | None) -> bytes:
    """Wyzwanie jest jednorazowe: po odczycie znika."""
    ch = db.get(WebauthnChallenge, cid)
    if ch is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=_ERR)
    db.delete(ch)
    db.flush()
    ok = ch.purpose == purpose and ch.expires_at > utcnow()
    if user is not None and ch.user_id != user.id:
        ok = False
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=_ERR)
    return _unb64(ch.challenge)


def _registration_options(db: Session, request: Request, user: User) -> dict:
    rp_id, _ = rp_and_origin(request)
    existing = [
        PublicKeyCredentialDescriptor(id=_unb64(c.credential_id))
        for c in db.scalars(select(WebauthnCredential).where(WebauthnCredential.user_id == user.id))
    ]
    challenge = os.urandom(32)
    opts = generate_registration_options(
        rp_id=rp_id,
        rp_name="Identyfikacja pracowników APT",
        user_id=str(user.id).encode(),
        user_name=user.username,
        user_display_name=user.full_name,
        challenge=challenge,
        timeout=120_000,
        attestation=AttestationConveyancePreference.NONE,
        exclude_credentials=existing,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    cid = _store_challenge(db, challenge, "register", user)
    return {"challenge_id": cid, "options": json.loads(options_to_json(opts))}


def _register_credential(
    db: Session, request: Request, user: User, challenge_id: str, credential: dict, name: str | None
) -> WebauthnCredential:
    rp_id, origin = rp_and_origin(request)
    challenge = _take_challenge(db, challenge_id, "register", user)
    try:
        res = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except Exception as exc:  # noqa: BLE001 - biblioteka zgłasza wiele różnych wyjątków
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=_ERR) from exc
    cid = _b64(res.credential_id)
    if db.scalar(select(WebauthnCredential).where(WebauthnCredential.credential_id == cid)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Ten klucz jest już zapisany.")
    cred = WebauthnCredential(
        user_id=user.id,
        credential_id=cid,
        public_key=res.credential_public_key,
        sign_count=res.sign_count,
        name=(name or "Klucz dostępu").strip()[:100] or "Klucz dostępu",
    )
    db.add(cred)
    audit(db, request, "passkey_added", user=user, details={"name": cred.name})
    return cred


def _start_session(db: Session, request: Request, response: Response, user: User, *, pending: bool) -> MeOut:
    settings = get_settings()
    now = utcnow()
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
    db.flush()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api",
    )
    return _me(user, sess)


# --- logowanie kluczem dostępu ---------------------------------------------------


class LoginOptionsOut(BaseModel):
    challenge_id: str
    options: dict


@router.post("/auth/passkey/options", response_model=LoginOptionsOut)
def login_options(request: Request, db: DbSession) -> LoginOptionsOut:
    """Bez nazwy użytkownika: urządzenie samo wskaże klucz (poświadczenia „discoverable”)."""
    rp_id, _ = rp_and_origin(request)
    challenge = os.urandom(32)
    opts = generate_authentication_options(
        rp_id=rp_id,
        challenge=challenge,
        timeout=120_000,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    cid = _store_challenge(db, challenge, "login", None)
    db.commit()
    return LoginOptionsOut(challenge_id=cid, options=json.loads(options_to_json(opts)))


class PasskeyLoginIn(BaseModel):
    challenge_id: str = Field(max_length=64)
    credential: dict


@router.post("/auth/passkey/login", response_model=MeOut)
def login_passkey(body: PasskeyLoginIn, request: Request, response: Response, db: DbSession) -> MeOut:
    rp_id, origin = rp_and_origin(request)
    challenge = _take_challenge(db, body.challenge_id, "login", None)
    raw_id = str(body.credential.get("id") or body.credential.get("rawId") or "")
    cred = db.scalar(select(WebauthnCredential).where(WebauthnCredential.credential_id == raw_id))
    user = db.get(User, cred.user_id) if cred else None
    if cred is None or user is None or not user.is_active:
        audit(db, request, "login_failed", details={"reason": "passkey_unknown"})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=_ERR)
    if user.locked_until is not None and user.locked_until > utcnow():
        audit(db, request, "login_blocked", user=user)
        db.commit()
        raise HTTPException(status.HTTP_423_LOCKED, detail="Konto jest tymczasowo zablokowane.")
    try:
        res = verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=cred.public_key,
            credential_current_sign_count=cred.sign_count,
            require_user_verification=True,
        )
    except Exception as exc:  # noqa: BLE001
        _register_failure(db, user, request, "login_failed", reason="passkey")
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=_ERR) from exc
    cred.sign_count = res.new_sign_count
    cred.last_used_at = utcnow()
    # weryfikacja użytkownika (biometria / PIN) na urządzeniu z kluczem zastępuje drugi składnik
    me = _start_session(db, request, response, user, pending=False)
    audit(db, request, "login", user=user, details={"method": "passkey"})
    db.commit()
    return me


# --- zarządzanie kluczami zalogowanego użytkownika --------------------------------


class PasskeyOut(BaseModel):
    id: int
    name: str
    created_at: str
    last_used_at: str | None


@router.get("/passkeys", response_model=list[PasskeyOut])
def list_passkeys(ctx: Auth, db: DbSession) -> list[PasskeyOut]:
    rows = db.scalars(
        select(WebauthnCredential)
        .where(WebauthnCredential.user_id == ctx.user.id)
        .order_by(WebauthnCredential.id)
    )
    return [
        PasskeyOut(
            id=c.id,
            name=c.name,
            created_at=c.created_at.isoformat(),
            last_used_at=c.last_used_at.isoformat() if c.last_used_at else None,
        )
        for c in rows
    ]


class PasskeyOptionsIn(BaseModel):
    password: str | None = Field(default=None, max_length=256)
    code: str | None = Field(default=None, max_length=20)


@router.post("/passkeys/options", response_model=LoginOptionsOut)
def passkey_options(
    ctx: Auth, request: Request, db: DbSession, body: PasskeyOptionsIn | None = None
) -> LoginOptionsOut:
    user = ctx.user
    if user.role != Role.employee:
        # konta z szerokimi uprawnieniami: ponowne potwierdzenie hasłem i kodem tuż przed dodaniem klucza
        body = body or PasskeyOptionsIn()
        if not verify_password(user.password_hash, body.password or ""):
            _register_failure(db, user, request, "passkey_reauth_failed", step="password")
            db.commit()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Podaj poprawne obecne hasło.")
        if user.mfa_enabled:
            step = _check_totp(user, body.code or "")
            if step is None:
                _register_failure(db, user, request, "passkey_reauth_failed", step="code")
                db.commit()
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy kod z aplikacji.")
            user.totp_last_step = step
    out = _registration_options(db, request, user)
    db.commit()
    return LoginOptionsOut(**out)


class PasskeyAddIn(BaseModel):
    challenge_id: str = Field(max_length=64)
    credential: dict
    name: str | None = Field(default=None, max_length=100)


@router.post("/passkeys", status_code=status.HTTP_201_CREATED)
def add_passkey(body: PasskeyAddIn, ctx: Auth, request: Request, db: DbSession) -> dict:
    _register_credential(db, request, ctx.user, body.challenge_id, body.credential, body.name)
    db.commit()
    notify.security_notice(ctx.user, "dodano klucz dostępu do logowania")
    return {"ok": True}


@router.delete("/passkeys/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_passkey(passkey_id: int, ctx: Auth, request: Request, db: DbSession) -> None:
    cred = db.get(WebauthnCredential, passkey_id)
    if cred is None or cred.user_id != ctx.user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono klucza.")
    user = ctx.user
    others = db.scalar(
        select(WebauthnCredential.id).where(
            WebauthnCredential.user_id == user.id, WebauthnCredential.id != cred.id
        )
    )
    if user.role == Role.employee and others is None and not user.has_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="To jedyny sposób logowania. Dodaj najpierw drugi klucz albo ustaw hasło.",
        )
    db.delete(cred)
    audit(db, request, "passkey_removed", user=user, details={"name": cred.name})
    db.commit()


# --- konto pracownika: kadry --------------------------------------------------------


def employee_username(e: Employee) -> str:
    return f"pr{e.number:06d}"


class AccountOut(BaseModel):
    exists: bool
    username: str | None = None
    active: bool = False
    has_passkey: bool = False
    has_password: bool = False
    last_login_at: str | None = None
    invite_pending: bool = False


def _account_out(db: Session, e: Employee) -> AccountOut:
    u = db.scalar(select(User).where(User.employee_id == e.id))
    if u is None:
        return AccountOut(exists=False)
    now = utcnow()
    pending = db.scalar(
        select(PasswordToken.id).where(
            PasswordToken.user_id == u.id,
            PasswordToken.purpose == INVITE_PURPOSE,
            PasswordToken.used_at.is_(None),
            PasswordToken.expires_at > now,
        )
    )
    return AccountOut(
        exists=True,
        username=u.username,
        active=u.is_active,
        has_passkey=db.scalar(select(WebauthnCredential.id).where(WebauthnCredential.user_id == u.id))
        is not None,
        has_password=u.has_password,
        last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
        invite_pending=pending is not None,
    )


def _employee_or_404(db: Session, employee_id: int) -> Employee:
    e = db.get(Employee, employee_id)
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Nie znaleziono pracownika.")
    return e


@router.get("/employees/{employee_id}/account", response_model=AccountOut)
def get_account(employee_id: int, ctx: StaffAuth, db: DbSession) -> AccountOut:
    return _account_out(db, _employee_or_404(db, employee_id))


class InviteIn(BaseModel):
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InviteOut(BaseModel):
    link: str
    sent: bool
    account: AccountOut


def invite_email(e: Employee, link: str) -> Email:
    return Email(
        subject="Zaproszenie do konta – Identyfikacja pracowników APT",
        title="Załóż swoje konto",
        preheader=f"Zaproszenie jest ważne {INVITE_DAYS} dni.",
        greeting=f"Dzień dobry {e.first_name},",
        paragraphs=[
            "kadry zapraszają Cię do konta w systemie identyfikacji pracowników. "
            "Zalogujesz się w nim twarzą, odciskiem palca albo PIN-em telefonu – bez hasła.",
            "Otwórz link na telefonie, który będzie Twoim kluczem, i potwierdź datę urodzenia.",
        ],
        button=("Załóż konto", link),
        notice=f"Link jest ważny {INVITE_DAYS} dni i działa tylko raz.",
        footer_note="Jeśli nie spodziewałeś się tej wiadomości – zignoruj ją.",
    )


def _has_access(db: Session, user: User) -> bool:
    """Czy konto jest już aktywowane (ma klucz dostępu albo hasło)."""
    return user.has_password or (
        db.scalar(select(WebauthnCredential.id).where(WebauthnCredential.user_id == user.id)) is not None
    )


@router.post("/employees/{employee_id}/account/invite", response_model=InviteOut)
def invite_account(
    employee_id: int, body: InviteIn, ctx: StaffAuth, request: Request, db: DbSession
) -> InviteOut:
    e = _employee_or_404(db, employee_id)
    user = db.scalar(select(User).where(User.employee_id == e.id))
    if user is None:
        username = employee_username(e)
        if db.scalar(select(User.id).where(User.username == username)):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Login pracownika jest już zajęty.")
        user = User(
            username=username,
            full_name=f"{e.first_name} {e.last_name}",
            role=Role.employee,
            password_hash=NO_PASSWORD,
            must_change_password=False,
            employee_id=e.id,
        )
        db.add(user)
        db.flush()
    else:
        if not user.is_active:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Konto jest wyłączone. Najpierw je włącz.")
        if _has_access(db, user):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="Konto jest już aktywne. Jeśli pracownik utracił dostęp, użyj „Zresetuj dostęp”.",
            )
    now = utcnow()
    db.execute(
        PasswordToken.__table__.update()
        .where(PasswordToken.user_id == user.id, PasswordToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = new_token()
    db.add(
        PasswordToken(
            user_id=user.id,
            token_hash=token_hash(token),
            purpose=INVITE_PURPOSE,
            expires_at=now + timedelta(days=INVITE_DAYS),
        )
    )
    link = mailer.link("/zaproszenie?token=" + token)
    sent = bool(body.email) and mailer.send(body.email, invite_email(e, link))
    audit(
        db,
        request,
        "employee_account_invited",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"channel": "email" if sent else "link"},
    )
    db.commit()
    return InviteOut(link=link, sent=bool(sent), account=_account_out(db, e))


def reset_email(e: Employee) -> Email:
    return Email(
        subject="Zresetowano dostęp do Twojego konta – Identyfikacja pracowników APT",
        title="Dostęp do konta został zresetowany",
        greeting=f"Dzień dobry {e.first_name},",
        paragraphs=[
            "kadry zresetowały dostęp do Twojego konta (klucze dostępu, hasło i kody zostały usunięte). "
            "Wylogowano Cię ze wszystkich urządzeń.",
            "Wkrótce dostaniesz nowe zaproszenie, aby ustawić dostęp od nowa.",
        ],
        tone="warning",
        footer_note="Jeśli to dla Ciebie niespodzianka – skontaktuj się z kadrami.",
    )


@router.post("/employees/{employee_id}/account/reset", response_model=AccountOut)
def reset_account(
    employee_id: int, ctx: StaffAuth, request: Request, db: DbSession, body: InviteIn | None = None
) -> AccountOut:
    """Utrata telefonu: usuwa klucze, hasło i kody, kończy sesje. Potem można wysłać nowe zaproszenie."""
    e = _employee_or_404(db, employee_id)
    user = db.scalar(select(User).where(User.employee_id == e.id))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pracownik nie ma konta.")
    db.execute(WebauthnCredential.__table__.delete().where(WebauthnCredential.user_id == user.id))
    user.password_hash = NO_PASSWORD
    totp.clear(user)
    now = utcnow()
    db.execute(
        PasswordToken.__table__.update()
        .where(PasswordToken.user_id == user.id, PasswordToken.used_at.is_(None))
        .values(used_at=now)
    )
    db.execute(
        UserSession.__table__.update()
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    to = body.email if body else None
    audit(
        db,
        request,
        "employee_account_reset",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
        details={"notified": bool(to)},
    )
    db.commit()
    if to:
        mailer.send(to, reset_email(e))
    return _account_out(db, e)


class ActiveIn(BaseModel):
    active: bool


@router.post("/employees/{employee_id}/account/active", response_model=AccountOut)
def set_account_active(
    employee_id: int, body: ActiveIn, ctx: StaffAuth, request: Request, db: DbSession
) -> AccountOut:
    e = _employee_or_404(db, employee_id)
    user = db.scalar(select(User).where(User.employee_id == e.id))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Pracownik nie ma konta.")
    user.is_active = body.active
    if not body.active:
        db.execute(
            UserSession.__table__.update()
            .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
    audit(
        db,
        request,
        "employee_account_enabled" if body.active else "employee_account_disabled",
        user=ctx.user,
        entity_type="employee",
        entity_id=e.id,
    )
    db.commit()
    return _account_out(db, e)


# --- zaproszenie: strona publiczna ----------------------------------------------------


def _invite(db: Session, token: str) -> tuple[PasswordToken, User, Employee]:
    t = notify.find_token(db, token, utcnow())
    if t is None or t.purpose != INVITE_PURPOSE or t.user.employee_id is None:
        raise HTTPException(status.HTTP_410_GONE, detail="Zaproszenie wygasło albo zostało już wykorzystane.")
    if _has_access(db, t.user):  # konto już aktywowane – stare zaproszenie nie może go przejąć
        raise HTTPException(status.HTTP_410_GONE, detail="To konto jest już aktywne.")
    return t, t.user, db.get(Employee, t.user.employee_id)


class InviteInfo(BaseModel):
    name: str
    needs_birth_date: bool


@router.get("/auth/invite/{token}", response_model=InviteInfo)
def invite_info(token: str, db: DbSession) -> InviteInfo:
    _, user, e = _invite(db, token)
    return InviteInfo(name=user.full_name, needs_birth_date=e.birth_date is not None)


def _check_birth(db: Session, request: Request, user: User, e: Employee, birth_date) -> None:  # noqa: ANN001
    if e.birth_date is None or birth_date == e.birth_date:
        return
    locked = _register_failure(db, user, request, "invite_failed", reason="birth_date")
    db.commit()
    if locked:
        raise HTTPException(status.HTTP_423_LOCKED, detail="Za dużo błędnych prób. Spróbuj później.")
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Data urodzenia się nie zgadza.")


class InviteStartIn(BaseModel):
    token: str = Field(max_length=200)
    birth_date: str | None = None


def _parse_date(v: str | None):  # noqa: ANN202
    from datetime import date

    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        return None


@router.post("/auth/invite/options", response_model=LoginOptionsOut)
def invite_options(body: InviteStartIn, request: Request, db: DbSession) -> LoginOptionsOut:
    _, user, e = _invite(db, body.token)
    if user.locked_until is not None and user.locked_until > utcnow():
        raise HTTPException(status.HTTP_423_LOCKED, detail="Za dużo błędnych prób. Spróbuj później.")
    _check_birth(db, request, user, e, _parse_date(body.birth_date))
    out = _registration_options(db, request, user)
    db.commit()
    return LoginOptionsOut(**out)


class InvitePasskeyIn(InviteStartIn):
    challenge_id: str = Field(max_length=64)
    credential: dict


@router.post("/auth/invite/passkey", response_model=MeOut)
def invite_passkey(body: InvitePasskeyIn, request: Request, response: Response, db: DbSession) -> MeOut:
    t, user, e = _invite(db, body.token)
    _check_birth(db, request, user, e, _parse_date(body.birth_date))
    _register_credential(db, request, user, body.challenge_id, body.credential, "Telefon")
    t.used_at = utcnow()
    me = _start_session(db, request, response, user, pending=False)
    audit(db, request, "employee_account_activated", user=user, details={"method": "passkey"})
    db.commit()
    return me


class InvitePasswordIn(InviteStartIn):
    password: str = Field(min_length=1, max_length=200)


@router.post("/auth/invite/password", response_model=MeOut)
def invite_password(body: InvitePasswordIn, request: Request, response: Response, db: DbSession) -> MeOut:
    """Zapas dla urządzeń bez kluczy dostępu: hasło + obowiązkowy kod z aplikacji."""
    t, user, e = _invite(db, body.token)
    _check_birth(db, request, user, e, _parse_date(body.birth_date))
    problems = password_problems(body.password, user.username)
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=" ".join(problems))
    user.password_hash = hash_password(body.password)
    user.password_changed_at = utcnow()
    t.used_at = utcnow()
    me = _start_session(db, request, response, user, pending=False)
    audit(db, request, "employee_account_activated", user=user, details={"method": "password"})
    db.commit()
    return me


# --- „Moje konto” ----------------------------------------------------------------------


class MyEmployeeOut(BaseModel):
    number: str
    first_name: str
    last_name: str
    birth_date: str | None
    has_passkey: bool
    has_password: bool


@router.get("/me/employee", response_model=MyEmployeeOut)
def my_employee(ctx: Auth, db: DbSession) -> MyEmployeeOut:
    if ctx.user.employee_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Konto nie jest powiązane z pracownikiem.")
    e = db.get(Employee, ctx.user.employee_id)
    return MyEmployeeOut(
        number=f"{e.number:06d}",
        first_name=e.first_name,
        last_name=e.last_name,
        birth_date=e.birth_date.isoformat() if e.birth_date else None,
        has_passkey=db.scalar(select(WebauthnCredential.id).where(WebauthnCredential.user_id == ctx.user.id))
        is not None,
        has_password=ctx.user.has_password,
    )
