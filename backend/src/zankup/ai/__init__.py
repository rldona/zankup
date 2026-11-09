"""The AI assistant (phase 7): summaries of each activity, the weekly report, the Coach and the MCP
server, all on a small model through the official SDK (OS-701). Without an Anthropic key every AI
feature is hidden and the rest of Zankup works the same.

The model never receives coordinates, routes or profile data: `zankup.ai.context` builds what it sees
from aggregated numbers only (OS-702), and `zankup.ai.tools` answers the Coach's and the MCP server's
questions from the same minimised views.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.db.models import UserSettings

# Which AI features the user keeps on (OS-708); `enabled` is the global switch.
AI_DEFAULTS = {"enabled": True, "summaries": True, "weekly": True}


def ai_preferences(session: Session, user_id: int) -> dict[str, bool]:
    stored = session.scalar(select(UserSettings.ai).where(UserSettings.user_id == user_id))
    return {key: bool((stored or {}).get(key, default)) for key, default in AI_DEFAULTS.items()}


def ai_wants(session: Session, user_id: int, feature: str) -> bool:
    """Whether the global switch and the feature's own switch are both on."""
    prefs = ai_preferences(session, user_id)
    return prefs["enabled"] and prefs.get(feature, False)
