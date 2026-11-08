"""Store of original activity files (OS-104).

The original file is the source of truth: everything else can be recomputed from it, so it is written
once and never changed. Files are addressed by a key such as `1/garmin/24966749792.fit` (user, source,
external ID) and verified by their SHA-256, which the `activities` row keeps.

`RawStore` is the interface the rest of the code uses; `LocalRawStore` keeps files under DATA_DIR/raw
(Railway's volume). An object-storage implementation can replace it without touching callers.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from opensport.core.config import Settings

_KEY = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$")


class StorageError(RuntimeError):
    pass


class ImmutableFileError(StorageError):
    """A different file already exists under that key: originals are never overwritten."""


class IntegrityError(StorageError):
    """A stored file no longer matches its recorded SHA-256."""


@dataclass(frozen=True)
class StoredFile:
    key: str
    sha256: str
    size: int


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_key(user_id: int, source: str, external_id: str, extension: str = "fit") -> str:
    """`{user_id}/{source}/{external_id}.{extension}`, the key every original file is stored under."""
    key = f"{user_id}/{source}/{external_id}.{extension.lstrip('.')}"
    _check_key(key)
    return key


def _check_key(key: str) -> None:
    if not _KEY.match(key) or ".." in key.split("/"):
        raise StorageError(f"Invalid storage key: {key!r}")


class RawStore(Protocol):
    def put(self, key: str, data: bytes) -> StoredFile:
        """Store `data` under `key`. Storing identical content again is a no-op; different content fails."""
        ...

    def get(self, key: str, expected_sha256: str | None = None) -> bytes:
        """The stored bytes, checked against `expected_sha256` when given."""
        ...

    def exists(self, key: str) -> bool: ...


class LocalRawStore:
    """Files on a local disk or volume, written atomically and left read-only."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        _check_key(key)
        return self.root / key

    def put(self, key: str, data: bytes) -> StoredFile:
        path = self._path(key)
        digest = sha256(data)
        if path.exists():
            if sha256(path.read_bytes()) != digest:
                raise ImmutableFileError(f"{key} already exists with different content")
            return StoredFile(key, digest, len(data))
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temporary file in the same folder and rename: readers never see a partial file.
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            os.chmod(tmp, 0o444)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return StoredFile(key, digest, len(data))

    def get(self, key: str, expected_sha256: str | None = None) -> bytes:
        path = self._path(key)
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            raise StorageError(f"{key} is not in the store") from None
        if expected_sha256 is not None and sha256(data) != expected_sha256:
            raise IntegrityError(f"{key} does not match its recorded SHA-256")
        return data

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


def get_raw_store(settings: Settings) -> RawStore:
    return LocalRawStore(settings.raw_dir)
