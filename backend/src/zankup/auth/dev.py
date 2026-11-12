"""One-click sign-in for local development: `POST /api/auth/dev-login` opens a browser session as the
instance's first user, with no password or code.

Only when DEV_LOGIN is on, which the settings refuse in production. The route is always registered so
the API contract is the same everywhere; otherwise it answers 404.
"""

import logging

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from zankup.auth.deps import AppSettings, DbSession
from zankup.auth.routes import Me, start_session
from zankup.db.models import User

log = logging.getLogger("zankup.auth.dev")

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/dev-login", operation_id="devLogin")
def dev_login(response: Response, db: DbSession, settings: AppSettings) -> Me:
    """Development only: sign in as the first user without a password or code."""
    if not settings.dev_login or settings.is_production:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Development sign-in is not enabled")
    user = db.scalars(select(User).order_by(User.id).limit(1)).first()
    if user is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Create the account at /setup first")
    log.warning("Development sign-in used for %s", user.email)
    result = start_session(db, user, response, settings, web=True, remember=True, device_name="Dev")
    assert isinstance(result, Me)
    return result
