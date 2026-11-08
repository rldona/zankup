"""Turn real Garmin activity-list items into a committed test fixture (OS-103, rules in fixtures/README.md).

Reads the JSON items that backend/garmin_sync.py saved in data/activities/ and writes a JSON array shaped
exactly like a Personal API page, with everything personal removed or moved:

- owner fields, location name, UUID and profile image URLs are dropped;
- the activity ID becomes a fake one (9000000001, 9000000002…) and the name a generic one;
- start and end coordinates go to the neutral place used by the FIT fixtures;
- dates and epoch timestamps move by whole weeks to January 2020, like the FIT fixtures.

Usage:
    uv run python tools/scrub_garmin_list.py OUTPUT.json ACTIVITY_ID [ACTIVITY_ID…]
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from anonymise_fit import NEUTRAL_LAT, NEUTRAL_LON, week_shift

DROP = {"ownerId", "ownerDisplayName", "ownerFullName", "locationName", "activityUUID", "deviceId", "userPro"}
DATE_KEYS = ("startTimeLocal", "startTimeGMT", "endTimeGMT")
EPOCH_MS_KEYS = ("beginTimestamp",)
FAKE_ID_BASE = 9_000_000_000
SOURCE = Path(__file__).resolve().parent.parent / "data" / "activities"


def scrub(item: dict[str, Any], fake_id: int) -> dict[str, Any]:
    start = datetime.fromisoformat(item["startTimeGMT"]).replace(tzinfo=UTC)
    shift = timedelta(seconds=week_shift(start))
    out: dict[str, Any] = {}
    for key, value in item.items():
        if key in DROP or "ProfileImage" in key or "Url" in key:
            continue
        if key == "activityId":
            out[key] = fake_id
        elif key == "activityName":
            out[key] = f"{item.get('activityType', {}).get('typeKey', 'activity').replace('_', ' ').title()}"
        elif key in DATE_KEYS and isinstance(value, str):
            out[key] = (datetime.fromisoformat(value) + shift).strftime("%Y-%m-%d %H:%M:%S")
        elif key in EPOCH_MS_KEYS and isinstance(value, int):
            out[key] = value + int(shift.total_seconds() * 1000)
        elif key.endswith("Latitude") and value is not None:
            out[key] = NEUTRAL_LAT
        elif key.endswith("Longitude") and value is not None:
            out[key] = NEUTRAL_LON
        else:
            out[key] = value
    return out


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    target, ids = Path(sys.argv[1]), sys.argv[2:]
    items = [json.loads((SOURCE / f"{aid}.json").read_text()) for aid in ids]
    items.sort(key=lambda a: a["startTimeGMT"], reverse=True)  # the API lists newest first
    page = [scrub(item, FAKE_ID_BASE + n) for n, item in enumerate(items, start=1)]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(page, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(page)} activities → {target}")


if __name__ == "__main__":
    main()
