"""Sign-in rate limiting with increasing delays, per client IP and per account.

In memory: the API runs as a single process per instance. After FREE_FAILURES failures within WINDOW,
every new failure locks the key for twice as long as the previous one (30 s, 1 min, 2 min… 15 min).
A successful sign-in clears the account's key.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

FREE_FAILURES = 5
WINDOW_S = 15 * 60
BASE_LOCK_S = 30
MAX_LOCK_S = 15 * 60


@dataclass
class _State:
    failures: deque[float] = field(default_factory=deque)
    locked_until: float = 0.0


class LoginLimiter:
    def __init__(self, now: Callable[[], float] = time.monotonic) -> None:
        self._state: dict[str, _State] = {}
        self._lock = threading.Lock()
        self._now = now

    def retry_after(self, *keys: str) -> int:
        """Seconds to wait before another attempt with any of these keys (0 = allowed)."""
        now = self._now()
        with self._lock:
            return max(
                (
                    int(s.locked_until - now) + 1
                    for k in keys
                    if (s := self._state.get(k)) and s.locked_until > now
                ),
                default=0,
            )

    def failure(self, *keys: str) -> None:
        now = self._now()
        with self._lock:
            for key in keys:
                state = self._state.setdefault(key, _State())
                state.failures.append(now)
                while state.failures and state.failures[0] < now - WINDOW_S:
                    state.failures.popleft()
                extra = len(state.failures) - FREE_FAILURES
                if extra >= 0:
                    state.locked_until = now + min(BASE_LOCK_S * 2**extra, MAX_LOCK_S)

    def success(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._state.pop(key, None)


limiter = LoginLimiter()
