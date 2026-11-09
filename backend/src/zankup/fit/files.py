"""Any activity file → `ParsedActivity`: FIT, TCX or GPX, gzipped or not (OS-404)."""

from __future__ import annotations

import gzip
import io

from zankup.fit.parser import FitParseError, ParsedActivity, parse_fit
from zankup.fit.xml import parse_gpx, parse_tcx

FORMATS = ("fit", "tcx", "gpx")
MAX_UNCOMPRESSED = 200 * 1024 * 1024  # a gzipped activity larger than this is not an activity


def file_format(name: str) -> str | None:
    """ "fit", "tcx" or "gpx" from a file name such as `123.fit.gz`, or None."""
    lower = name.lower().removesuffix(".gz")
    extension = lower.rsplit(".", 1)[-1] if "." in lower else ""
    return extension if extension in FORMATS else None


def gunzip(data: bytes) -> bytes:
    if data[:2] != b"\x1f\x8b":
        return data
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as file:
        out = file.read(MAX_UNCOMPRESSED + 1)
    if len(out) > MAX_UNCOMPRESSED:
        raise FitParseError("The compressed file is too large")
    return out


def parse_file(data: bytes, fmt: str) -> ParsedActivity:
    """Parse an (uncompressed) activity file of the given format."""
    match fmt:
        case "fit":
            return parse_fit(data)
        case "tcx":
            return parse_tcx(data)
        case "gpx":
            return parse_gpx(data)
    raise FitParseError(f"Unknown activity format: {fmt}")
