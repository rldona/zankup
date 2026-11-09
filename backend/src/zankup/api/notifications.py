"""Push subscriptions (OS-401): the browser subscribes with the server's VAPID key and sends the
subscription here. Which kinds are sent is a preference (`/api/settings`, OS-402)."""

from __future__ import annotations

from fastapi import HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.db.models import PushSubscription
from zankup.notify import deliver, forget, language_of, message, public_key, vapid_key

router = protected_router(prefix="/api/notifications", tags=["notifications"])


class PushKey(BaseModel):
    public_key: str = Field(description="VAPID application server key (base64url)")


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=2000, pattern=r"^https://")
    keys: SubscriptionKeys
    name: str | None = Field(default=None, max_length=120)


class SubscriptionOut(BaseModel):
    id: int
    name: str | None


class Unsubscribe(BaseModel):
    endpoint: str = Field(max_length=2000)


class TestResult(BaseModel):
    sent: int


@router.get("/key", operation_id="getPushKey")
def push_key(settings: AppSettings) -> PushKey:
    return PushKey(public_key=public_key(vapid_key(settings)))


@router.post("/subscriptions", operation_id="subscribePush", status_code=201)
def subscribe(body: SubscriptionIn, db: DbSession, user: CurrentUser) -> SubscriptionOut:
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if row is not None and row.user_id != user.id:
        db.delete(row)  # the browser now belongs to someone else
        db.flush()
        row = None
    if row is None:
        row = PushSubscription(user_id=user.id, endpoint=body.endpoint, p256dh="", auth="")
        db.add(row)
    row.p256dh, row.auth, row.name, row.failures = body.keys.p256dh, body.keys.auth, body.name, 0
    db.commit()
    return SubscriptionOut(id=row.id, name=row.name)


@router.post("/unsubscribe", operation_id="unsubscribePush", status_code=204)
def unsubscribe(body: Unsubscribe, db: DbSession, user: CurrentUser) -> Response:
    forget(db, user.id, body.endpoint)
    db.commit()
    return Response(status_code=204)


@router.get("/subscriptions", operation_id="listPushSubscriptions")
def subscriptions(db: DbSession, user: CurrentUser) -> list[SubscriptionOut]:
    rows = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id))
    return [SubscriptionOut(id=r.id, name=r.name) for r in rows]


@router.post("/test", operation_id="testPush")
def test(db: DbSession, user: CurrentUser, settings: AppSettings) -> TestResult:
    """Send a test notification to every subscribed browser, now."""
    content = message("test", {}, language_of(db, user.id))
    sent = deliver(db, settings, user.id, content)
    db.commit()
    if sent == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "No browser accepted the notification")
    return TestResult(sent=sent)
