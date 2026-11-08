"""Daily backups and restore (OS-114): the database and the original FIT files, off the volume.

A backup is:
- `db/zankup-YYYY-MM-DD.dump`: `pg_dump --format=custom` of the whole database. The last
  BACKUP_KEEP_DAYS are kept.
- `raw/<user>/<source>/<id>.fit`: the original files. They never change (storage.py), so each one is
  uploaded once and kept for good: the daily run only adds the new ones.
- `latest.json`: which dump is the newest, with its SHA-256 and the number of files.

Everything else (streams, metrics) is in the database or can be recomputed from the FIT files. The
destination is any S3-compatible bucket (Railway, Cloudflare R2, Backblaze B2…) or a local directory.

    python -m zankup.backup run                       # back up now
    python -m zankup.backup list                      # what is stored
    python -m zankup.backup restore --database-url postgresql://… --data-dir ./restored [--date …]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import shlex
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from zankup.core.config import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

log = logging.getLogger("zankup.backup")

DUMP_PREFIX = "db/"
RAW_PREFIX = "raw/"
MANIFEST = "latest.json"
DUMP_DATE = re.compile(r"-(\d{4}-\d{2}-\d{2})\.dump$")


class BackupError(RuntimeError):
    pass


# --- destinations ----------------------------------------------------------------------------------


class ObjectStore(Protocol):
    def upload(self, key: str, path: Path) -> None: ...
    def download(self, key: str, path: Path) -> None: ...
    def put_bytes(self, key: str, data: bytes) -> None: ...
    def get_bytes(self, key: str) -> bytes: ...
    def sizes(self, prefix: str) -> dict[str, int]: ...
    def delete(self, keys: list[str]) -> None: ...


class LocalObjectStore:
    """A directory, for self-hosting with a second disk (and for the tests)."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise BackupError(f"Invalid key: {key}")
        return path

    def upload(self, key: str, path: Path) -> None:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())

    def download(self, key: str, path: Path) -> None:
        path.write_bytes(self._path(key).read_bytes())

    def put_bytes(self, key: str, data: bytes) -> None:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def sizes(self, prefix: str) -> dict[str, int]:
        base = self._path(prefix) if prefix else self.root
        if not base.exists():
            return {}
        return {
            path.relative_to(self.root).as_posix(): path.stat().st_size
            for path in base.rglob("*")
            if path.is_file()
        }

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            self._path(key).unlink(missing_ok=True)


class S3ObjectStore:
    def __init__(self, client: S3Client, bucket: str) -> None:
        self.client, self.bucket = client, bucket

    def upload(self, key: str, path: Path) -> None:
        self.client.upload_file(str(path), self.bucket, key)

    def download(self, key: str, path: Path) -> None:
        self.client.download_file(self.bucket, key, str(path))

    def put_bytes(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def get_bytes(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def sizes(self, prefix: str) -> dict[str, int]:
        found: dict[str, int] = {}
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                found[item["Key"]] = item["Size"]
        return found

    def delete(self, keys: list[str]) -> None:
        for start in range(0, len(keys), 1000):
            chunk = [{"Key": key} for key in keys[start : start + 1000]]
            self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": chunk})  # type: ignore[typeddict-item]


def backup_store(settings: Settings) -> ObjectStore | None:
    """Where backups go, or None when backups are not configured."""
    if settings.backup_s3_bucket:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=settings.backup_s3_endpoint,
            region_name=settings.backup_s3_region,
            aws_access_key_id=settings.backup_s3_access_key_id,
            aws_secret_access_key=settings.backup_s3_secret_access_key.get_secret_value()
            if settings.backup_s3_secret_access_key
            else None,
            config=Config(s3={"addressing_style": "virtual"}, retries={"mode": "standard"}),
        )
        return S3ObjectStore(client, settings.backup_s3_bucket)
    if settings.backup_dir:
        return LocalObjectStore(settings.backup_dir)
    return None


# --- database --------------------------------------------------------------------------------------


def libpq_url(url: str) -> str:
    """postgresql+psycopg://… → postgresql://…, the form pg_dump and pg_restore understand."""
    scheme, _, rest = url.partition("://")
    return f"{scheme.split('+')[0]}://{rest}"


def _run(command: list[str], stdin: Path | None = None, stdout: Path | None = None) -> None:
    with (
        open(stdin, "rb") if stdin else open(os.devnull, "rb") as source,
        open(stdout, "wb") if stdout else open(os.devnull, "wb") as sink,
    ):
        result = subprocess.run(command, stdin=source, stdout=sink, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        error = result.stderr.decode(errors="replace").strip()[-1000:]
        raise BackupError(f"{Path(command[0]).name} failed ({result.returncode}): {error}")


def dump_database(settings: Settings, database_url: str, target: Path) -> None:
    command = [*shlex.split(settings.pg_dump_command), "--format=custom", "--no-owner", "--no-privileges"]
    _run([*command, f"--dbname={libpq_url(database_url)}"], stdout=target)


def restore_database(settings: Settings, database_url: str, dump: Path) -> None:
    """Into an empty (or disposable) database: existing objects are dropped first."""
    command = [*shlex.split(settings.pg_restore_command), "--clean", "--if-exists", "--no-owner"]
    _run([*command, "--no-privileges", "--exit-on-error", f"--dbname={libpq_url(database_url)}"], stdin=dump)


# --- backup and restore ----------------------------------------------------------------------------


@dataclass(frozen=True)
class BackupResult:
    dump_key: str
    dump_bytes: int
    raw_uploaded: int
    raw_total: int
    dumps_deleted: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _raw_files(raw_dir: Path) -> Iterator[tuple[str, Path]]:
    if raw_dir.exists():
        for path in sorted(raw_dir.rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                yield RAW_PREFIX + path.relative_to(raw_dir).as_posix(), path


def dump_date(key: str) -> date | None:
    """The day in a dump's name, whatever its prefix (dumps made under the earlier working name too)."""
    match = DUMP_DATE.search(key)
    return date.fromisoformat(match.group(1)) if match else None


def dump_key(day: date) -> str:
    return f"{DUMP_PREFIX}zankup-{day.isoformat()}.dump"


def run_backup(
    settings: Settings, store: ObjectStore, *, database_url: str | None = None, today: date | None = None
) -> BackupResult:
    today = today or datetime.now(UTC).date()
    with tempfile.TemporaryDirectory() as tmp:
        dump = Path(tmp) / "zankup.dump"
        dump_database(settings, database_url or settings.database_url, dump)
        key = dump_key(today)
        store.upload(key, dump)
        dump_bytes, dump_sha = dump.stat().st_size, _sha256(dump)

    stored = store.sizes(RAW_PREFIX)
    uploaded = total = 0
    for raw_key, path in _raw_files(settings.raw_dir):
        total += 1
        if stored.get(raw_key) != path.stat().st_size:
            store.upload(raw_key, path)
            uploaded += 1

    cutoff = today - timedelta(days=settings.backup_keep_days - 1)
    old = sorted(k for k in store.sizes(DUMP_PREFIX) if (d := dump_date(k)) is not None and d < cutoff)
    if old:
        store.delete(old)
    manifest = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "dump": key,
        "dump_sha256": dump_sha,
        "dump_bytes": dump_bytes,
        "raw_files": total,
    }
    store.put_bytes(MANIFEST, json.dumps(manifest, indent=2).encode())
    log.info(
        "Backup finished",
        extra={"dump": key, "dump_bytes": dump_bytes, "raw_uploaded": uploaded, "raw_total": total},
    )
    return BackupResult(key, dump_bytes, uploaded, total, len(old))


def restore(
    settings: Settings, store: ObjectStore, *, database_url: str, data_dir: Path, day: date | None = None
) -> tuple[str, int]:
    """Restore a dump (the latest, or that day's) into `database_url` and the FIT files into
    `data_dir/raw`. Returns (dump key, files restored)."""
    if day is None:
        manifest = json.loads(store.get_bytes(MANIFEST))
        key, expected = manifest["dump"], manifest["dump_sha256"]
    else:
        key, expected = dump_key(day), None
        if key not in store.sizes(DUMP_PREFIX):
            raise BackupError(f"There is no backup for {day}")
    with tempfile.TemporaryDirectory() as tmp:
        dump = Path(tmp) / "zankup.dump"
        store.download(key, dump)
        if expected and _sha256(dump) != expected:
            raise BackupError(f"{key} does not match the SHA-256 in {MANIFEST}")
        restore_database(settings, database_url, dump)

    raw_dir, restored = data_dir / "raw", 0
    for raw_key in sorted(store.sizes(RAW_PREFIX)):
        target = raw_dir / raw_key.removeprefix(RAW_PREFIX)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        store.download(raw_key, target)
        target.chmod(0o444)  # read-only, like the raw store writes them
        restored += 1
    return key, restored


# --- command line ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    from zankup.core.config import get_settings
    from zankup.core.logging import configure_logging

    parser = argparse.ArgumentParser(prog="python -m zankup.backup", description="Backups and restore")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="back up now")
    commands.add_parser("list", help="list the stored database dumps")
    restore_cmd = commands.add_parser("restore", help="restore into a database and a data directory")
    restore_cmd.add_argument("--database-url", required=True, help="target database (it is overwritten)")
    restore_cmd.add_argument("--data-dir", type=Path, required=True, help="target for raw/ (the FIT files)")
    restore_cmd.add_argument("--date", type=date.fromisoformat, help="that day's dump instead of the latest")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)
    store = backup_store(settings)
    if store is None:
        print("Backups are not configured: set BACKUP_S3_* or BACKUP_DIR", file=sys.stderr)
        return 2
    try:
        if args.command == "run":
            result = run_backup(settings, store)
            print(
                f"{result.dump_key} ({result.dump_bytes // 1024} KB), "
                f"{result.raw_uploaded} new FIT files ({result.raw_total} in total)"
            )
        elif args.command == "list":
            for key, size in sorted(store.sizes(DUMP_PREFIX).items()):
                print(f"{key}  {size // 1024} KB")
        else:
            key, files = restore(
                settings, store, database_url=args.database_url, data_dir=args.data_dir, day=args.date
            )
            print(f"Restored {key} and {files} FIT files into {args.data_dir / 'raw'}")
    except BackupError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
