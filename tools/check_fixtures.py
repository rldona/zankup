"""Fail if any committed fixture contains personal data (OS-010). Runs in CI.

Rules for everything under fixtures/:
- FIT, TCX and GPX: every coordinate inside the neutral area, every date in 2020 (dates are moved by
  whole weeks), no user profile values, no unknown or developer fields with data, serial numbers
  neutral, no author or e-mail.
- Recorded HTTP responses (cassettes, .yaml/.yml/.json): no Authorization or API key headers, no bearer
  tokens or JWTs, no e-mail addresses, no owner or location fields, every latitude/longitude inside the
  neutral area and every date in 2020.
- Any other file type fails, so new kinds of fixtures get a rule before they are committed.

Usage:
    uv run python tools/check_fixtures.py [fixtures-dir]
"""

from __future__ import annotations

import re
import sys
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import fitdecode

from anonymise_fit import NEUTRAL_END, NEUTRAL_LAT, NEUTRAL_LON, NEUTRAL_RADIUS_DEG, NEUTRAL_SERIAL

SEMICIRCLE_TO_DEG = 180 / 2**31
NEUTRAL_YEAR_START = datetime(2020, 1, 1, tzinfo=UTC)
ANY_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}")  # ISO and Garmin's "YYYY-MM-DD HH:MM"
ROOT = Path(__file__).resolve().parent.parent / "fixtures"

COORD_PATTERNS = [
    re.compile(r'\blat="(-?\d+(?:\.\d+)?)"[^>]*?\blon="(-?\d+(?:\.\d+)?)"'),
    re.compile(
        r"<LatitudeDegrees>(-?[\d.]+)</LatitudeDegrees>\s*<LongitudeDegrees>(-?[\d.]+)</LongitudeDegrees>"
    ),
]
JSON_COORDS = re.compile(
    r'"(?:lat|latitude|startLatitude|endLatitude)"\s*:\s*(-?\d+(?:\.\d+)?)[^{}]*?'
    r'"(?:lon|lng|longitude|startLongitude|endLongitude)"\s*:\s*(-?\d+(?:\.\d+)?)',
    re.S,
)
SECRETS = [
    (
        re.compile(r"(?im)^\s*['\"]?(authorization|x-api-key|apikey|api-key|cookie|set-cookie)['\"]?\s*:"),
        "auth header",
    ),
    (re.compile(r"(?i)\b(bearer|apikey)\s+[A-Za-z0-9._~+/=-]{12,}"), "token"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "JWT"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "e-mail"),
    (
        re.compile(r'"(owner\w*|locationName|userProfile\w*|displayName|fullName)"\s*:'),
        "owner or location field",
    ),
]
TRACK_PERSONAL = [
    (re.compile(r"<author>|<email\b"), "author or e-mail"),
    (re.compile(r"<UnitId>(?!0<)\d+</UnitId>"), "device unit ID"),
]


def inside(lat: float, lon: float) -> bool:
    return abs(lat - NEUTRAL_LAT) <= NEUTRAL_RADIUS_DEG and abs(lon - NEUTRAL_LON) <= NEUTRAL_RADIUS_DEG


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _empty(value: object) -> bool:
    if isinstance(value, tuple | list):
        return all(_empty(v) for v in value)
    return value is None or value == "" or value == b""


def check_fit(path: Path) -> Iterator[str]:
    with fitdecode.FitReader(str(path), check_crc=fitdecode.CrcCheck.RAISE) as reader:
        for message in reader:
            if not isinstance(message, fitdecode.FitDataMessage):
                continue
            for field in message.fields:
                name, value = field.name, field.value
                if _empty(value) or field.is_expanded:  # expanded components repeat checked fields
                    continue
                where = f"{path.name}: {message.name}.{name}"
                if message.name == "user_profile":
                    yield f"{where} has a value (user profile must be blank)"
                elif name.startswith("unknown_") or message.name.startswith("unknown_"):
                    yield f"{where} is undocumented and not blank"
                elif isinstance(field.field_def, fitdecode.types.DevFieldDefinition):
                    yield f"{where} is a developer field and not blank"
                elif isinstance(value, datetime) and not NEUTRAL_YEAR_START <= _utc(value) < NEUTRAL_END:
                    yield f"{where} = {value:%Y-%m-%d} is not in 2020 (dates must be moved)"
                elif name == "serial_number" and value != NEUTRAL_SERIAL:
                    yield f"{where} is not the neutral serial"
                elif name.endswith(("_lat", "_long")) and isinstance(value, int):
                    degrees = value * SEMICIRCLE_TO_DEG
                    centre = NEUTRAL_LAT if name.endswith("_lat") else NEUTRAL_LON
                    if abs(degrees - centre) > NEUTRAL_RADIUS_DEG:
                        yield f"{where} = {degrees:.4f}° is outside the neutral area"


def check_text(path: Path, text: str, track: bool) -> Iterator[str]:
    patterns = COORD_PATTERNS if track else [JSON_COORDS, *COORD_PATTERNS]
    for pattern in patterns:
        for match in pattern.finditer(text):
            lat, lon = float(match.group(1)), float(match.group(2))
            if not inside(lat, lon):
                yield f"{path.name}: coordinate {lat:.4f}, {lon:.4f} is outside the neutral area"
                break
    # Tracks and recorded responses alike: every date must have been moved to 2020.
    for match in ANY_DATE.finditer(text):
        if match.group(1) != "2020":
            yield f"{path.name}: date {match.group(0)[:10]} is not in 2020 (dates must be moved)"
            break
    for pattern, label in TRACK_PERSONAL if track else SECRETS:
        if pattern.search(text):
            yield f"{path.name}: contains a {label}"


def check(root: Path = ROOT) -> list[str]:
    problems: list[str] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        suffix = path.suffix.lower()
        if path.name == "README.md":
            continue
        if suffix == ".fit":
            problems += check_fit(path)
        elif suffix in (".tcx", ".gpx"):
            problems += check_text(path, path.read_text(encoding="utf-8"), track=True)
        elif suffix in (".yaml", ".yml", ".json"):
            problems += check_text(path, path.read_text(encoding="utf-8"), track=False)
        else:
            problems.append(
                f"{path.relative_to(root)}: unknown fixture type, add a rule to tools/check_fixtures.py"
            )
    return problems


def main() -> None:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    problems = check(root)
    for problem in problems:
        print(f"::error::{problem}")
    count = sum(1 for p in root.rglob("*") if p.is_file() and p.name != "README.md")
    print(f"{count} fixtures checked, {len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
