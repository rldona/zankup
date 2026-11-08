#!/usr/bin/env python3
"""Download Garmin activities into data/activities/ with the OpenSport Garmin client.

A local tool, without a database: it keeps the original FIT and the list metadata of each activity as
files (used by tools/build_proto_data.py and to create fixtures). The real sync, into Postgres, is the
orchestrator in OS-108.

Usage (from the repository root, with GARMIN_PERSONAL_API_KEY in .env):
  uv run python backend/garmin_sync.py                  # what is new since the last run
  uv run python backend/garmin_sync.py --since 2026-10-01
  uv run python backend/garmin_sync.py --list           # list only, no download
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from opensport.core.config import Settings
from opensport.sync.garmin import GarminClient, GarminError
from opensport.sync.tokens import FileTokenCache

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ACTIVITIES = DATA / "activities"
STATE_FILE = DATA / "state.json"
TOKEN_FILE = DATA / ".garmin_token.json"
PAUSE_S = 1.0  # between downloads: a personal client, no rush


def summary(a: dict[str, Any]) -> str:
    sport = (a.get("activityType") or {}).get("typeKey", "?")
    km, seconds = (a.get("distance") or 0) / 1000, int(a.get("duration") or 0)
    return (
        f"{a.get('startTimeLocal', '?'):<19}  {sport:<20} {km:6.2f} km {seconds // 60:3d}:{seconds % 60:02d}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--since", type=date.fromisoformat, help="start date (YYYY-MM-DD)")
    parser.add_argument("--list", action="store_true", help="list only, no download")
    args = parser.parse_args()

    settings = Settings(_env_file=ROOT / ".env")
    key = settings.garmin_personal_api_key
    if key is None:
        sys.exit("GARMIN_PERSONAL_API_KEY is missing: create it in Garmin Connect and put it in .env")
    garmin = GarminClient(key.get_secret_value(), FileTokenCache(TOKEN_FILE))

    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    last = state.get("last_sync")
    since = args.since or (
        date.fromisoformat(last) - timedelta(days=1) if last else date.today() - timedelta(days=30)
    )

    activities = list(garmin.list_activities(since))
    print(f"{len(activities)} activities since {since}:")
    for activity in activities:
        print("  " + summary(activity))
    if args.list:
        return

    ACTIVITIES.mkdir(parents=True, exist_ok=True)
    new = 0
    for activity in sorted(activities, key=lambda a: a.get("startTimeGMT", "")):
        aid = activity["activityId"]
        fit_path = ACTIVITIES / f"{aid}.fit"
        if fit_path.exists():
            continue
        fit = garmin.download_fit(aid)
        fit_path.write_bytes(fit.data)
        (ACTIVITIES / f"{aid}.json").write_text(json.dumps(activity, indent=2, ensure_ascii=False))
        print(f"  ↓ {aid}  {fit.filename}  ({len(fit.data) // 1024} KB)")
        new += 1
        time.sleep(PAUSE_S)

    state["last_sync"] = date.today().isoformat()
    DATA.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))
    print(f"Done: {new} new activities in {ACTIVITIES.relative_to(ROOT)}/")


if __name__ == "__main__":
    try:
        main()
    except GarminError as error:
        sys.exit(f"Garmin API error: {error}")
