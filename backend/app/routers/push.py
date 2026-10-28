"""Powiadomienia push: zapis urządzenia, wyłączenie, test. Dostępne dla każdego zalogowanego konta."""

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app import push
from app.audit import audit
from app.deps import Auth, DbSession
from app.models import PushSubscription

router = APIRouter(prefix="/api/push", tags=["push"])


class Keys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=5, max_length=100)


class SubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: Keys


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)


@router.get("/key")
def key(ctx: Auth) -> dict[str, str]:
    return {"public_key": push.public_key()}


@router.get("/status")
def state(ctx: Auth, db: DbSession) -> dict[str, int]:
    n = db.scalar(
        select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == ctx.user.id)
    )
    return {"devices": n or 0}


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(body: SubscribeIn, ctx: Auth, request: Request, db: DbSession) -> None:
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy adres subskrypcji.")
    ua = (request.headers.get("user-agent") or "")[:200]
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth)
        db.add(sub)
    # to samo urządzenie po zmianie konta przechodzi na nowe konto
    sub.user_id, sub.p256dh, sub.auth, sub.user_agent = ctx.user.id, body.keys.p256dh, body.keys.auth, ua
    audit(db, request, "push_subscribed", user=ctx.user)
    db.commit()


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: UnsubscribeIn, ctx: Auth, request: Request, db: DbSession) -> None:
    sub = db.scalar(
        select(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == ctx.user.id
        )
    )
    if sub is not None:
        db.delete(sub)
        audit(db, request, "push_unsubscribed", user=ctx.user)
        db.commit()


@router.post("/unsubscribe-all", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe_all(ctx: Auth, request: Request, db: DbSession) -> None:
    for sub in db.scalars(select(PushSubscription).where(PushSubscription.user_id == ctx.user.id)):
        db.delete(sub)
    audit(db, request, "push_unsubscribed", user=ctx.user, details={"all": True})
    db.commit()


@router.post("/test")
def test(ctx: Auth, db: DbSession) -> dict[str, int]:
    n = push.notify_users(
        db, [ctx.user.id], "Test powiadomień", "Powiadomienia na tym urządzeniu działają.", "/"
    )
    if n == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="To konto nie ma włączonych powiadomień na żadnym urządzeniu."
        )
    return {"sent": n}
