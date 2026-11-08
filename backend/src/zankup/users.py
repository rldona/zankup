"""The owner of the instance. Until sign-up (OS-221) exists, the sync works for an owner account created
on demand with OWNER_EMAIL; sign-up will take over that same row."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.db.models import User, UserSettings


def ensure_owner(session: Session, email: str) -> User:
    """The instance's single user, created (with default settings) if there is none yet."""
    user = session.scalars(select(User).order_by(User.id).limit(1)).first()
    if user is None:
        user = User(email=email)
        session.add(user)
        session.flush()
        session.add(UserSettings(user_id=user.id))
        session.flush()
    return user
