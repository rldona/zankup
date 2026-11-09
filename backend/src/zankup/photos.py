"""Activity photos on the volume (OS-412).

Every photo is re-encoded when it arrives: turned upright, at most `FULL_PX` on its longest side, as
JPEG and **without any metadata** (EXIF, GPS position, camera). So nothing that is later shared can
reveal where a photo was taken. A thumbnail of `THUMB_PX` is kept next to it for the feed.

Files live under DATA_DIR/photos/{user_id}/{uuid}.jpg (and .thumb.jpg). Unlike original activity
files, photos can be removed.
"""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from zankup.core.config import Settings

FULL_PX = 2048
THUMB_PX = 480
MAX_PIXELS = 60_000_000  # larger than any phone photo; refuses decompression bombs
PHOTO_TYPES = (".jpg", ".jpeg", ".png", ".webp", ".heic")
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class PhotoError(ValueError):
    """Not an image we can read."""


@dataclass(frozen=True)
class SavedPhoto:
    key: str
    width: int
    height: int


def _encode(image: Image.Image, size: int) -> bytes:
    copy = image.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    copy.save(out, "JPEG", quality=85, optimize=True, progressive=True)  # no exif= : no metadata
    return out.getvalue()


class PhotoStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, key: str, thumb: bool = False) -> Path:
        if "/" not in key or ".." in key or not key.endswith(".jpg"):
            raise PhotoError("Invalid photo key")
        return self.root / (key.removesuffix(".jpg") + ".thumb.jpg" if thumb else key)

    def save(self, user_id: int, data: bytes) -> SavedPhoto:
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise PhotoError("The image is too large")
                image = ImageOps.exif_transpose(source).convert("RGB")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise PhotoError("Not an image that can be read") from error
        key = f"{user_id}/{uuid.uuid4().hex}.jpg"
        full = _encode(image, FULL_PX)
        thumb = _encode(image, THUMB_PX)
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(full)
        self.path(key, thumb=True).write_bytes(thumb)
        with Image.open(io.BytesIO(full)) as saved:
            return SavedPhoto(key, saved.width, saved.height)

    def read(self, key: str, thumb: bool = False) -> bytes:
        return self.path(key, thumb).read_bytes()

    def delete(self, key: str) -> None:
        for thumb in (False, True):
            self.path(key, thumb).unlink(missing_ok=True)


def get_photo_store(settings: Settings) -> PhotoStore:
    return PhotoStore(settings.data_dir / "photos")
