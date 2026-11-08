#!/usr/bin/env python3
"""Sync Garmin Connect activities into OpenSport using the official Personal API.

Flow:
  1. Exchange the personal key (GARMIN_PERSONAL_API_KEY) for a 24 h access token.
  2. List the activities since the last sync.
  3. Download the original ZIP of each new activity and extract its FIT.
  4. Store the FIT and its metadata in data/activities/ and update data/state.json.

Usage:
  python3 backend/garmin_sync.py                  # sync what is new
  python3 backend/garmin_sync.py --since 2026-10-01
  python3 backend/garmin_sync.py --list           # list only, no download

Standard library only. Seed of the Garmin client (OS-103).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ACTIVITIES = DATA / "activities"
STATE_FILE = DATA / "state.json"
TOKEN_FILE = DATA / ".garmin_token.json"

BASE_URL = os.environ.get("GARMIN_PERSONAL_API_BASE_URL", "https://personal.connectapi.garmin.com")
TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token"
LIST_PATH = "/activitylist-service/activities/search/activities"
DOWNLOAD_PATH = "/download-service/files/activity/{id}"
USER_AGENT = "OpenSport/0.1 (personal sync)"
PAGE_SIZE = 50
PAUSE_S = 1.0  # pause between downloads: a personal client, no rush


# ---------- configuration and state ----------


def load_env() -> None:
    """Load variables from a .env at the repository root without overriding existing ones."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)


def load_state() -> dict:
    return json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}


def save_state(state: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


# ---------- HTTP ----------


class ApiError(RuntimeError):
    pass


def http(method: str, path: str, headers: dict, params: dict | None = None) -> tuple[bytes, dict]:
    url = BASE_URL + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, **headers})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                wait = int(e.headers.get("Retry-After", "30"))
                print(f"  Garmin asks to wait {wait} s (429)…", file=sys.stderr)
                time.sleep(wait)
                continue
            body = e.read()[:300].decode("utf-8", "replace")
            raise ApiError(f"{method} {path} → HTTP {e.code}: {body}") from None
    raise ApiError(f"{method} {path}: too many retries")


# ---------- authentication ----------


def jwt_exp(token: str) -> float:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except Exception:
        return time.time() + 3600  # unreadable: assume 1 h


def get_token() -> str:
    if TOKEN_FILE.exists():
        cached = json.loads(TOKEN_FILE.read_text())
        if cached.get("exp", 0) - time.time() > 300:
            return cached["token"]
    key = os.environ.get("GARMIN_PERSONAL_API_KEY")
    if not key:
        sys.exit(
            "GARMIN_PERSONAL_API_KEY is missing: create it at "
            "https://connect.garmin.com/app/settings/personalApiToken and put it in .env"
        )
    body, _ = http("POST", TOKEN_PATH, {"Accept": "*/*", "Authorization": f"ApiKey {key}"})
    token = body.decode().strip()
    if token.startswith("{"):  # in case it ever comes back as JSON
        token = json.loads(token).get("access_token", token)
    write_private(TOKEN_FILE, json.dumps({"token": token, "exp": jwt_exp(token)}))
    return token


# ---------- API ----------


def list_activities(token: str, since: date) -> list[dict]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    out, start = [], 0
    while True:
        params = {
            "start": start,
            "limit": PAGE_SIZE,
            "startDate": since.isoformat(),
            "endDate": (date.today() + timedelta(days=1)).isoformat(),
        }
        body, _ = http("GET", LIST_PATH, headers, params)
        page = json.loads(body)
        if isinstance(page, dict):  # tolerate a wrapped response
            page = page.get("activityList") or page.get("activities") or []
        out.extend(page)
        if len(page) < PAGE_SIZE:
            return out
        start += PAGE_SIZE


def download_fit(token: str, activity_id: int) -> tuple[bytes, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/zip, application/x-zip-compressed, application/octet-stream",
    }
    body, _ = http("GET", DOWNLOAD_PATH.format(id=int(activity_id)), headers)
    if body[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".fit")] or z.namelist()
            return z.read(names[0]), names[0]
    if body[8:12] == b".FIT":  # uncompressed FIT
        return body, f"{activity_id}.fit"
    raise ApiError(f"Unexpected response downloading {activity_id}: {body[:60]!r}")


# ---------- main ----------


def summary(a: dict) -> str:
    t = (a.get("activityType") or {}).get("typeKey", "?")
    dist = a.get("distance") or 0
    dur = a.get("duration") or 0
    return (
        f"{a.get('startTimeLocal', '?'):<19}  {t:<20} {dist / 1000:6.2f} km "
        f"{int(dur // 60):3d}:{int(dur % 60):02d}  {a.get('activityName', '')}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", type=date.fromisoformat, help="start date (YYYY-MM-DD)")
    ap.add_argument("--list", action="store_true", help="list only, no download")
    args = ap.parse_args()

    load_env()
    state = load_state()
    since = args.since or (
        date.fromisoformat(state["last_sync"]) - timedelta(days=1)
        if state.get("last_sync")
        else date.today() - timedelta(days=30)
    )

    token = get_token()
    acts = list_activities(token, since)
    print(f"{len(acts)} activities since {since}:")
    for a in acts:
        print("  " + summary(a))
    if args.list:
        return

    ACTIVITIES.mkdir(parents=True, exist_ok=True)
    new = 0
    for a in sorted(acts, key=lambda a: a.get("startTimeGMT", "")):
        aid = a["activityId"]
        fit_path = ACTIVITIES / f"{aid}.fit"
        if fit_path.exists():
            continue
        fit, name = download_fit(token, aid)
        fit_path.write_bytes(fit)
        (ACTIVITIES / f"{aid}.json").write_text(json.dumps(a, indent=2, ensure_ascii=False))
        print(f"  ↓ {aid}  {name}  ({len(fit) // 1024} KB)")
        new += 1
        time.sleep(PAUSE_S)

    state["last_sync"] = date.today().isoformat()
    save_state(state)
    print(f"Done: {new} new activities in {ACTIVITIES.relative_to(ROOT)}/")


if __name__ == "__main__":
    try:
        main()
    except ApiError as e:
        sys.exit(f"Garmin API error: {e}")
