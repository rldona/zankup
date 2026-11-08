"""Token caches for source clients: in the database (production) or in a local file (scripts)."""

import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import Source
from zankup.sync.garmin import AccessToken


class DbTokenCache:
    """Keeps the token on the user's `sources` row, so every worker and API process shares it."""

    def __init__(self, sessions: sessionmaker[Session], user_id: int, kind: str = "garmin") -> None:
        self._sessions, self._user_id, self._kind = sessions, user_id, kind

    def _source(self, session: Session) -> Source | None:
        return session.scalar(
            select(Source).where(Source.user_id == self._user_id, Source.kind == self._kind)
        )

    def load(self) -> AccessToken | None:
        with self._sessions() as session:
            source = self._source(session)
            if source is None or not source.access_token or source.token_expires_at is None:
                return None
            return AccessToken(source.access_token, source.token_expires_at)

    def save(self, token: AccessToken) -> None:
        with self._sessions.begin() as session:
            source = self._source(session)
            if source is None:
                source = Source(user_id=self._user_id, kind=self._kind)
                session.add(source)
            source.access_token = token.value
            source.token_expires_at = token.expires_at


class FileTokenCache:
    """For local scripts without a database. The file is created readable by its owner only."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> AccessToken | None:
        try:
            data = json.loads(self._path.read_text())
            return AccessToken(data["token"], datetime.fromisoformat(data["expires_at"]))
        except (OSError, KeyError, ValueError):
            return None

    def save(self, token: AccessToken) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self._path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as file:
            json.dump({"token": token.value, "expires_at": token.expires_at.isoformat()}, file)
