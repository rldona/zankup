"""Import activities from a Garmin watch connected by USB (OS-608).

The watch keeps its original FIT files in `GARMIN/Activity/`. This script finds them on the mounted
watch, packs the ones it has not sent before into a ZIP and uploads it to your Zankup through the same
import as the web app (Settings → Your data → Import), which merges them with what Garmin's API already
brought (OS-406). Nothing leaves your computer except to your own instance.

    uv run tools/usb_import.py                          # finds the watch under /media, /run/media, /Volumes
    uv run tools/usb_import.py /path/to/GARMIN --url https://api.zankup.com --email you@example.com

It signs in with your e-mail, password and authenticator code (asked for, never stored) and signs that
session out at the end. The files already sent are remembered (by content) in
`~/.local/state/zankup/usb-import.json`, so plugging the watch in again only sends what is new.

Recent watches connect over MTP instead of as a disk: mount them first (for example with `jmtpfs` or
your file manager) and pass the path to their `GARMIN` folder.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import io
import json
import os
import socket
import sys
import time
import zipfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import httpx

DEFAULT_URL = "https://api.zankup.com"
STATE = (
    Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "zankup" / "usb-import.json"
)
MOUNTS = ("/media/{user}", "/run/media/{user}", "/Volumes")


def find_garmin(roots: Iterable[str] = MOUNTS) -> Path | None:
    """The `GARMIN` folder of the first mounted watch found."""
    user = getpass.getuser()
    for root in roots:
        base = Path(root.format(user=user))
        if not base.is_dir():
            continue
        for volume in sorted(base.iterdir()):
            folder = volume / "GARMIN"
            if (folder / "Activity").is_dir():
                return folder
    return None


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_state(path: Path = STATE) -> set[str]:
    try:
        return set(json.loads(path.read_text())["sent"])
    except (OSError, KeyError, ValueError):
        return set()


def save_state(sent: set[str], path: Path = STATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"sent": sorted(sent)}))


def new_files(garmin: Path, sent: set[str]) -> list[tuple[Path, bytes, str]]:
    """FIT files under `GARMIN/Activity` not sent before, oldest first."""
    out = []
    for file in sorted((garmin / "Activity").glob("*.[Ff][Ii][Tt]"), key=lambda p: p.stat().st_mtime):
        data = file.read_bytes()
        if data[8:12] == b".FIT" and (h := digest(data)) not in sent:
            out.append((file, data, h))
    return out


def pack(files: list[tuple[Path, bytes, str]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for file, data, _ in files:
            archive.writestr(file.name, data)
    return buffer.getvalue()


class Zankup:
    """The few API calls the import needs, with a session of its own."""

    def __init__(self, url: str, http: httpx.Client | None = None) -> None:
        self.url = url.rstrip("/")
        self.http = http or httpx.Client(timeout=60)
        self.token: str | None = None

    def _check(self, response: httpx.Response, what: str) -> Any:
        if response.status_code >= 400:
            detail = response.json().get("detail") if response.content else None
            raise SystemExit(f"{what} failed: HTTP {response.status_code} {detail or ''}".strip())
        return response.json() if response.content else None

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def sign_in(self, email: str, password: str, code: Callable[[], str]) -> None:
        name = f"USB import on {socket.gethostname()}"[:120]
        body = {"email": email, "password": password, "client": "android", "device_name": name}
        answer = self._check(self.http.post(f"{self.url}/api/auth/login", json=body), "Signing in")
        if answer.get("mfa_required"):
            totp = {"challenge": answer["challenge"], "code": code()}
            answer = self._check(self.http.post(f"{self.url}/api/auth/login/totp", json=totp), "The code")
        self.token = answer["access_token"]

    def sign_out(self) -> None:
        if self.token:
            self.http.post(f"{self.url}/api/auth/logout", headers=self.headers)
            self.token = None

    def upload(
        self, filename: str, data: bytes, progress: Callable[[int, int], None] = lambda *_: None
    ) -> int:
        created = self._check(
            self.http.post(
                f"{self.url}/api/imports",
                json={"filename": filename, "size": len(data)},
                headers=self.headers,
            ),
            "Starting the import",
        )
        target, import_id = created["upload"], created["import"]["id"]
        size = int(target["part_size"])
        for index, offset in enumerate(range(0, len(data), size)):
            part = self.http.put(
                f"{target['url']}/{index}",
                params={"token": target["token"]},
                content=data[offset : offset + size],
                headers={"Content-Type": "application/octet-stream"},
            )
            self._check(part, f"Uploading part {index}")
            progress(min(offset + size, len(data)), len(data))
        self._check(
            self.http.post(f"{self.url}/api/imports/{import_id}/finish", headers=self.headers), "Finishing"
        )
        return int(import_id)

    def wait(
        self, import_id: int, sleep: Callable[[float], None] = time.sleep, every: float = 2.0
    ) -> dict[str, Any]:
        while True:
            state = self._check(
                self.http.get(f"{self.url}/api/imports/{import_id}", headers=self.headers),
                "Checking the import",
            )
            if state["status"] in ("done", "error"):
                return dict(state)
            sleep(every)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("garmin", nargs="?", type=Path, help="The watch's GARMIN folder (found if omitted)")
    parser.add_argument("--url", default=os.environ.get("ZANKUP_URL", DEFAULT_URL), help="Your Zankup's API")
    parser.add_argument("--email", default=os.environ.get("ZANKUP_EMAIL"))
    parser.add_argument("--dry-run", action="store_true", help="Only list what would be sent")
    args = parser.parse_args(argv)

    garmin = args.garmin or find_garmin()
    if garmin is None or not (garmin / "Activity").is_dir():
        print("No watch found: connect it by USB, or pass the path to its GARMIN folder.", file=sys.stderr)
        return 1
    sent = load_state()
    files = new_files(garmin, sent)
    print(f"{garmin}: {len(files)} new activit{'y' if len(files) == 1 else 'ies'}")
    if not files or args.dry_run:
        for file, _, _ in files:
            print(f"  {file.name}")
        return 0

    zankup = Zankup(args.url)
    email = args.email or input("E-mail: ").strip()
    zankup.sign_in(email, getpass.getpass("Password: "), lambda: input("Authenticator code: ").strip())
    try:
        data = pack(files)
        import_id = zankup.upload(
            f"garmin-usb-{time.strftime('%Y%m%d-%H%M')}.zip",
            data,
            lambda done, total: print(f"\r  uploaded {done * 100 // total} %", end="", flush=True),
        )
        print("\n  importing…")
        result = zankup.wait(import_id)
    finally:
        zankup.sign_out()
    if result["status"] == "error":
        print(f"The import failed: {result.get('error')}", file=sys.stderr)
        return 1
    save_state(sent | {h for _, _, h in files})
    print(f"Done: {result['created']} new, {result['merged']} merged, {result['skipped']} already there.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
