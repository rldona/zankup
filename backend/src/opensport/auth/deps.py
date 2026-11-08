"""Who is calling: `current_user` accepts the browser's session cookie or the app's bearer token."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from opensport.auth.security import read_access_token, token_hash
from opensport.core.config import Settings, get_settings
from opensport.db.models import Device, User
from opensport.db.session import get_session

SESSION_COOKIE = "opensport_session"
LAST_SEEN_EVERY = timedelta(minutes=5)

DbSession = Annotated[Session, Depends(get_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def unauthorised() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not signed in", headers={"WWW-Authenticate": "Bearer"}
    )


def _touch(device: Device, now: datetime) -> None:
    if device.last_seen is None or now - device.last_seen > LAST_SEEN_EVERY:
        device.last_seen = now


def current_device(request: Request, db: DbSession, settings: AppSettings) -> Device:
    now = datetime.now(UTC)
    secret = settings.jwt_secret.get_secret_value() if settings.jwt_secret else None
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        ids = read_access_token(authorization[7:].strip(), secret)
        device = db.get(Device, ids[1]) if ids else None
        if device is None or ids is None or device.user_id != ids[0]:
            raise unauthorised()
    else:
        cookie = request.cookies.get(SESSION_COOKIE)
        if not cookie:
            raise unauthorised()
        device = db.scalar(select(Device).where(Device.refresh_token_hash == token_hash(cookie)))
        if device is None or device.platform != "web" or (device.expires_at and device.expires_at <= now):
            raise unauthorised()
    _touch(device, now)
    db.commit()
    return device


def current_user(device: Annotated[Device, Depends(current_device)], db: DbSession) -> User:
    user = db.get(User, device.user_id)
    if user is None:
        raise unauthorised()
    return user


CurrentUser = Annotated[User, Depends(current_user)]
CurrentDevice = Annotated[Device, Depends(current_device)]
