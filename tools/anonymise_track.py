"""Anonymise TCX and GPX files (plain or .gz) so they can be committed as test fixtures (OS-010).

Text-level rewrite, so the quirks of each exporter survive (for example the whitespace Strava puts
before the XML declaration of its TCX files):

- Every coordinate goes through the same move, mirror and rotation as the FIT fixtures, so the track
  starts at the neutral place and its shape cannot be matched to the original streets.
- Every date moves by whole weeks to the first weeks of 2020, like the FIT fixtures (weekday, time of
  day and durations are kept). The export date in the GPX metadata is removed.
- Author, e-mail, links and device unit IDs are removed or zeroed.
- With --max-points N, only the first N track points are kept (fixtures stay small).

Usage:
    uv run python tools/anonymise_track.py INPUT(.tcx|.gpx)[.gz] OUTPUT [--max-points N]
"""

from __future__ import annotations

import argparse
import gzip
import re
from datetime import datetime, timedelta
from pathlib import Path

from anonymise_fit import transform, week_shift

ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?")
FIRST_POINT_TIME = re.compile(r"<(?:Time|time)>([^<]+)</(?:Time|time)>")

GPX_POINT = re.compile(
    r'(<(?:trkpt|rtept|wpt)\b[^>]*?\blat=")(-?\d+(?:\.\d+)?)("[^>]*?\blon=")(-?\d+(?:\.\d+)?)(")'
)
TCX_POSITION = re.compile(
    r"(<LatitudeDegrees>)(-?\d+(?:\.\d+)?)(</LatitudeDegrees>\s*<LongitudeDegrees>)(-?\d+(?:\.\d+)?)(</LongitudeDegrees>)"
)
BLOCKS = {
    "gpx": re.compile(r"\s*<trkpt\b.*?</trkpt>", re.S),
    "tcx": re.compile(r"\s*<Trackpoint>.*?</Trackpoint>", re.S),
}
PERSONAL = [
    (re.compile(r"\s*<author>.*?</author>", re.S), ""),
    (re.compile(r"\s*<email\b[^>]*/>"), ""),
    (re.compile(r"\s*<link\b.*?(?:/>|</link>)", re.S), ""),
    (re.compile(r"\s*<bounds\b[^>]*/>"), ""),
    (re.compile(r"(<metadata>.*?)\s*<time>[^<]*</time>(.*?</metadata>)", re.S), r"\g<1>\g<2>"),
    (re.compile(r"(<UnitId>)\d+(</UnitId>)"), r"\g<1>0\g<2>"),
]


def _fmt(value: float, like: str) -> str:
    decimals = len(like.split(".")[1]) if "." in like else 0
    return f"{value:.{min(max(decimals, 6), 8)}f}"


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_like(moved: datetime, original: str) -> str:
    """Write the moved date with the same precision and zone notation as the original."""
    text = moved.isoformat()
    if "." not in original:
        text = moved.replace(microsecond=0).isoformat()
    if original.endswith("Z"):
        text = text.replace("+00:00", "Z")
    return text


def anonymise_track(text: str, kind: str, max_points: int | None = None) -> str:
    if max_points is not None:
        count = 0

        def keep_first(match: re.Match[str]) -> str:
            nonlocal count
            count += 1
            return match.group(0) if count <= max_points else ""

        text = BLOCKS[kind].sub(keep_first, text)

    for pattern, replacement in PERSONAL:
        text = pattern.sub(replacement, text)

    first_time = FIRST_POINT_TIME.search(text)
    if first_time:
        shift = timedelta(seconds=week_shift(_parse(first_time.group(1))))
        text = ISO_DATE.sub(lambda m: _format_like(_parse(m.group(0)) + shift, m.group(0)), text)

    if kind == "gpx":
        first = GPX_POINT.search(text)
        if first:
            origin = (float(first.group(2)), float(first.group(4)))

            def move_point(m: re.Match[str]) -> str:
                lat, lon = transform(float(m.group(2)), float(m.group(4)), origin)
                return f"{m.group(1)}{_fmt(lat, m.group(2))}{m.group(3)}{_fmt(lon, m.group(4))}{m.group(5)}"

            text = GPX_POINT.sub(move_point, text)
    else:
        first = TCX_POSITION.search(text)
        if first:
            origin = (float(first.group(2)), float(first.group(4)))

            def move_position(m: re.Match[str]) -> str:
                lat, lon = transform(float(m.group(2)), float(m.group(4)), origin)
                return f"{m.group(1)}{_fmt(lat, m.group(2))}{m.group(3)}{_fmt(lon, m.group(4))}{m.group(5)}"

            text = TCX_POSITION.sub(move_position, text)
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--max-points", type=int)
    args = parser.parse_args()
    raw = args.source.read_bytes()
    if args.source.suffix == ".gz":
        raw = gzip.decompress(raw)
    kind = "tcx" if ".tcx" in args.source.name.lower() else "gpx"
    text = anonymise_track(raw.decode("utf-8"), kind, args.max_points)
    args.target.write_text(text, encoding="utf-8")
    print(f"{args.source.name} → {args.target} ({args.target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
