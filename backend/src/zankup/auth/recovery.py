"""Recovery codes (OS-221): eight single-use codes that replace the TOTP code when the phone is lost.

Shown once, at the end of sign-up; only their SHA-256 is stored (they are random, 50 bits each, and
sign-in is rate limited, so a slow hash adds nothing).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from zankup.db.models import RecoveryCode, User

RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
RECOVERY_CODES = 8


# --- recovery codes --------------------------------------------------------------------------------


def _recovery_digest(code: str) -> str:
    return hashlib.sha256("".join(c for c in code.lower() if c.isalnum()).encode()).hexdigest()


def new_recovery_codes(db: Session, user: User) -> list[str]:
    """Replace the user's recovery codes with 8 new ones. Returns them once: only hashes are kept."""
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = []
    for _ in range(RECOVERY_CODES):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(10))
        code = f"{raw[:5]}-{raw[5:]}"
        db.add(RecoveryCode(user_id=user.id, code_hash=_recovery_digest(code)))
        codes.append(code)
    return codes


def looks_like_recovery_code(code: str) -> bool:
    return any(c.isalpha() for c in code)


def use_recovery_code(db: Session, user: User, code: str) -> bool:
    """True, and the code is spent, when it is one of the user's unused recovery codes."""
    row = db.scalar(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user.id,
            RecoveryCode.code_hash == _recovery_digest(code),
            RecoveryCode.used_at.is_(None),
        )
    )
    if row is None:
        return False
    row.used_at = datetime.now(UTC)
    return True
