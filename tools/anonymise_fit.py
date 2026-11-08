"""Anonymise FIT activity files so they can be committed as test fixtures (OS-010).

The file is rewritten byte by byte, so every message, timestamp and metric stays exactly as recorded,
except for what could identify the person:

- Every position (records, laps, sessions, splits, segments…) is moved so the activity starts at a
  neutral place (Hyde Park, London), and the track is mirrored and rotated around its start so its
  shape cannot be matched against the streets where it was recorded. Track lengths change by less than
  0.05 % (the recorded distance fields are untouched), and elevation is untouched.
- Dates move to the first weeks of 2020: every date_time field is shifted by a whole number of weeks,
  so the time of day, the weekday and every duration stay the same (and compressed timestamps, which
  only store the low 5 bits of the time, stay valid because a week is a multiple of 32 s).
- The user profile (name, age, sex, height, weight, resting and max HR…) is blanked.
- Serial numbers become 1234567890, ANT+ sensor IDs are blanked and long digit runs in device names
  (e.g. "HRM200:656389") become zeros.
- Fields and messages the FIT profile does not document, and developer fields, are blanked, because
  nobody can tell what they hold (some Garmin private messages carry positions).

Blanked means set to the FIT "invalid" value of the field's base type, so decoders read it as missing.
The file CRC is recomputed.

Usage:
    uv run python tools/anonymise_fit.py INPUT.fit OUTPUT.fit
"""

from __future__ import annotations

import math
import re
import struct
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import fitdecode.profile as fit_profile

# Neutral place every activity is moved to, and the area fixtures must stay in (checked in CI).
NEUTRAL_LAT, NEUTRAL_LON = 51.5073, -0.1657  # Hyde Park, London
NEUTRAL_RADIUS_DEG = 1.5
NEUTRAL_SERIAL = 1234567890
NEUTRAL_START = datetime(2020, 1, 6, tzinfo=UTC)  # activities move to the week starting on this Monday
NEUTRAL_END = datetime(2021, 1, 1, tzinfo=UTC)  # every date in a fixture must be before this
FIT_EPOCH = datetime(1989, 12, 31, tzinfo=UTC)
FIT_MIN_DATE = 0x10000000  # smaller date_time values are relative (seconds since device power-on)
WEEK = 7 * 86_400


def week_shift(first: datetime) -> int:
    """Seconds to add so `first` lands in the neutral week, keeping its weekday and time of day."""
    weeks = math.ceil((NEUTRAL_START - first).total_seconds() / WEEK)
    shift = weeks * WEEK
    if first.timestamp() + shift >= NEUTRAL_START.timestamp() + WEEK:
        shift -= WEEK
    return shift


SEMICIRCLES_PER_DEG = 2**31 / 180
ROTATION_DEG = 137.0  # fixed, so every fixture is transformed the same way and tests stay stable
# One constant for both axes (spherical Earth): rotating mixes them, so they must use the same scale.
M_PER_DEG = 6_371_008.8 * math.pi / 180


def transform(lat: float, lon: float, origin: tuple[float, float]) -> tuple[float, float]:
    """Move a point (degrees) so `origin` lands on the neutral place, mirroring and rotating around it.

    Uses a local flat projection around the origin, which keeps distances for activity-sized areas.
    """
    lat0, lon0 = origin
    x = (lon - lon0) * M_PER_DEG * math.cos(math.radians(lat0))
    y = (lat - lat0) * M_PER_DEG
    x = -x  # mirror
    a = math.radians(ROTATION_DEG)
    x, y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    return (
        NEUTRAL_LAT + y / M_PER_DEG,
        NEUTRAL_LON + x / (M_PER_DEG * math.cos(math.radians(NEUTRAL_LAT))),
    )


# Base types by number (the low 5 bits of the base type byte): (size, struct code, invalid value).
BASE_TYPES: dict[int, tuple[int, str, int]] = {
    0x00: (1, "B", 0xFF),  # enum
    0x01: (1, "b", 0x7F),  # sint8
    0x02: (1, "B", 0xFF),  # uint8
    0x03: (2, "h", 0x7FFF),  # sint16
    0x04: (2, "H", 0xFFFF),  # uint16
    0x05: (4, "i", 0x7FFFFFFF),  # sint32
    0x06: (4, "I", 0xFFFFFFFF),  # uint32
    0x07: (1, "s", 0x00),  # string
    0x08: (4, "I", 0xFFFFFFFF),  # float32 (invalid is all ones)
    0x09: (8, "Q", 0xFFFFFFFFFFFFFFFF),  # float64
    0x0A: (1, "B", 0x00),  # uint8z
    0x0B: (2, "H", 0x0000),  # uint16z
    0x0C: (4, "I", 0x00000000),  # uint32z
    0x0D: (1, "B", 0xFF),  # byte
    0x0E: (8, "q", 0x7FFFFFFFFFFFFFFF),  # sint64
    0x0F: (8, "Q", 0xFFFFFFFFFFFFFFFF),  # uint64
    0x10: (8, "Q", 0x0000000000000000),  # uint64z
}

PROFILE = fit_profile.MESSAGE_TYPES
BLANK_MESSAGES = {"user_profile"}
BLANK_FIELDS = {"ant_device_number"}

_CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
              0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400]  # fmt: skip


def fit_crc(data: bytes | bytearray, crc: int = 0) -> int:
    for byte in data:
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ _CRC_TABLE[byte & 0xF]
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc = crc ^ tmp ^ _CRC_TABLE[(byte >> 4) & 0xF]
    return crc


@dataclass
class FieldDef:
    num: int
    size: int
    base_type: int  # 0xFF for developer fields
    developer: bool = False


@dataclass
class MessageDef:
    global_num: int
    endian: str  # "<" or ">"
    fields: list[FieldDef]


def _field_name(global_num: int, field_num: int) -> str | None:
    message = PROFILE.get(global_num)
    if message is None:
        return None
    field = message.fields.get(field_num)
    return field.name if field is not None else None


def _is_date(global_num: int, field_num: int) -> bool:
    message = PROFILE.get(global_num)
    field = message.fields.get(field_num) if message is not None else None
    type_name = getattr(getattr(field, "type", None), "name", "")
    return type_name in ("date_time", "local_date_time")


def _is_position(name: str | None) -> tuple[bool, bool]:
    """(is a position field, is latitude)."""
    if name is None:
        return False, False
    if name.endswith("_lat"):
        return True, True
    if name.endswith("_long"):
        return True, False
    return False, False


class Anonymiser:
    def __init__(self, data: bytes) -> None:
        self.buf = bytearray(data)
        self.origin: tuple[float, float] | None = None  # first recorded position, in degrees
        self.time_shift: int | None = None  # seconds added to every date

    # --- walking the file -------------------------------------------------------------------------

    def _walk(self, visit: bool) -> None:
        """Parse every chained FIT file in the buffer. With visit=True, patch data messages."""
        pos = 0
        while pos < len(self.buf):
            header_size = self.buf[pos]
            if self.buf[pos + 8 : pos + 12] != b".FIT":
                raise ValueError(f"Not a FIT file at offset {pos}")
            data_size = struct.unpack_from("<I", self.buf, pos + 4)[0]
            start, end = pos + header_size, pos + header_size + data_size
            self._walk_records(start, end, visit)
            if visit:
                struct.pack_into("<H", self.buf, end, fit_crc(self.buf[pos:end]))
            pos = end + 2

    def _walk_records(self, pos: int, end: int, visit: bool) -> None:
        local: dict[int, MessageDef] = {}
        while pos < end:
            header = self.buf[pos]
            pos += 1
            if header & 0x80:  # compressed timestamp header: data message
                definition = local[(header >> 5) & 0x03]
                pos = self._data(definition, pos, visit)
            elif header & 0x40:  # definition message
                has_dev = bool(header & 0x20)
                endian = ">" if self.buf[pos + 1] == 1 else "<"
                global_num = struct.unpack_from(endian + "H", self.buf, pos + 2)[0]
                count = self.buf[pos + 4]
                pos += 5
                fields = [FieldDef(*self.buf[pos + 3 * i : pos + 3 * i + 3]) for i in range(count)]
                pos += 3 * count
                if has_dev:
                    dev_count = self.buf[pos]
                    pos += 1
                    for i in range(dev_count):
                        num, size, _index = self.buf[pos + 3 * i : pos + 3 * i + 3]
                        fields.append(FieldDef(num, size, 0x0D, developer=True))
                    pos += 3 * dev_count
                local[header & 0x0F] = MessageDef(global_num, endian, fields)
            else:  # normal data message
                pos = self._data(local[header & 0x0F], pos, visit)

    # --- patching ---------------------------------------------------------------------------------

    def _data(self, definition: MessageDef, pos: int, visit: bool) -> int:
        message_name = PROFILE[definition.global_num].name if definition.global_num in PROFILE else None
        if not visit and self.origin is None and message_name == "record":
            self._find_origin(definition, pos)
        if not visit and self.time_shift is None and message_name is not None:
            self._find_first_date(definition, pos)
        start = pos
        for field in definition.fields:
            if visit:
                self._patch(definition, message_name, field, pos)
            pos += field.size
        if visit and message_name is not None and message_name not in BLANK_MESSAGES:
            self._patch_positions(definition, start)
        return pos

    def _patch_positions(self, definition: MessageDef, start: int) -> None:
        """Transform each latitude/longitude pair of a message (e.g. start_position_lat/_long)."""
        endian, offset = definition.endian, start
        located: dict[str, dict[str, int]] = {}
        for field in definition.fields:
            name = None if field.developer else _field_name(definition.global_num, field.num)
            is_position, is_lat = _is_position(name)
            if is_position and field.size == 4 and name is not None:
                prefix = name.rsplit("_", 1)[0]
                located.setdefault(prefix, {})["lat" if is_lat else "lon"] = offset
            offset += field.size
        for pair in located.values():
            lat_at, lon_at = pair.get("lat"), pair.get("lon")
            if lat_at is None or lon_at is None:
                for at in pair.values():  # a lone half of a pair cannot be transformed: drop it
                    struct.pack_into(endian + "i", self.buf, at, 0x7FFFFFFF)
                continue
            lat = struct.unpack_from(endian + "i", self.buf, lat_at)[0]
            lon = struct.unpack_from(endian + "i", self.buf, lon_at)[0]
            if lat == 0x7FFFFFFF or lon == 0x7FFFFFFF or (lat == 0 and lon == 0):
                continue
            if self.origin is None:  # no GPS track to anchor on: drop the position
                struct.pack_into(endian + "i", self.buf, lat_at, 0x7FFFFFFF)
                struct.pack_into(endian + "i", self.buf, lon_at, 0x7FFFFFFF)
                continue
            new_lat, new_lon = transform(lat / SEMICIRCLES_PER_DEG, lon / SEMICIRCLES_PER_DEG, self.origin)
            struct.pack_into(endian + "i", self.buf, lat_at, round(new_lat * SEMICIRCLES_PER_DEG))
            struct.pack_into(endian + "i", self.buf, lon_at, round(new_lon * SEMICIRCLES_PER_DEG))

    def _find_first_date(self, definition: MessageDef, pos: int) -> None:
        for field in definition.fields:
            if not field.developer and field.size == 4 and _is_date(definition.global_num, field.num):
                value = struct.unpack_from(definition.endian + "I", self.buf, pos)[0]
                if FIT_MIN_DATE <= value != 0xFFFFFFFF:
                    self.time_shift = week_shift(FIT_EPOCH.fromtimestamp(FIT_EPOCH.timestamp() + value, UTC))
                    return
            pos += field.size

    def _find_origin(self, definition: MessageDef, record_pos: int) -> None:
        offsets, offset = {}, 0
        for field in definition.fields:
            offsets[(field.num, field.developer)] = (offset, field)
            offset += field.size
        lat_info, lon_info = offsets.get((0, False)), offsets.get((1, False))
        if not lat_info or not lon_info:
            return
        lat = struct.unpack_from(definition.endian + "i", self.buf, record_pos + lat_info[0])[0]
        lon = struct.unpack_from(definition.endian + "i", self.buf, record_pos + lon_info[0])[0]
        if lat != 0x7FFFFFFF and lon != 0x7FFFFFFF:
            self.origin = (lat / SEMICIRCLES_PER_DEG, lon / SEMICIRCLES_PER_DEG)

    def _blank(self, field: FieldDef, endian: str, pos: int) -> None:
        size, code, invalid = BASE_TYPES.get(field.base_type & 0x1F, (1, "B", 0xFF))
        if code == "s":
            self.buf[pos : pos + field.size] = b"\x00" * field.size
            return
        for i in range(field.size // size):
            struct.pack_into(endian + code, self.buf, pos + i * size, invalid)
        self.buf[pos + (field.size // size) * size : pos + field.size] = b"\xff" * (field.size % size)

    def _patch(self, definition: MessageDef, message_name: str | None, field: FieldDef, pos: int) -> None:
        endian = definition.endian
        if field.developer or message_name is None or message_name in BLANK_MESSAGES:
            self._blank(field, endian, pos)
            return
        name = _field_name(definition.global_num, field.num)
        if name is None or name in BLANK_FIELDS:
            self._blank(field, endian, pos)
            return
        if message_name == "device_info" and field.base_type & 0x1F == 0x07:
            text = bytes(self.buf[pos : pos + field.size])
            self.buf[pos : pos + field.size] = re.sub(rb"\d{4,}", lambda m: b"0" * len(m.group()), text)
            return
        if field.size == 4 and _is_date(definition.global_num, field.num):
            value = struct.unpack_from(endian + "I", self.buf, pos)[0]
            if FIT_MIN_DATE <= value != 0xFFFFFFFF and self.time_shift is not None:
                struct.pack_into(endian + "I", self.buf, pos, value + self.time_shift)
            return
        if name == "serial_number" and field.size == 4:
            struct.pack_into(endian + "I", self.buf, pos, NEUTRAL_SERIAL)
            return
        is_position, _ = _is_position(name)
        if is_position and field.size == 4:
            return  # handled per message in _patch_positions, which needs latitude and longitude together

    def run(self) -> bytes:
        self._walk(visit=False)  # find the first recorded position
        self._walk(visit=True)
        return bytes(self.buf)


def anonymise_fit(data: bytes) -> bytes:
    return Anonymiser(data).run()


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, target = Path(sys.argv[1]), Path(sys.argv[2])
    target.write_bytes(anonymise_fit(source.read_bytes()))
    print(f"{source.name} → {target} ({target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
