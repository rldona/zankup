"""Editing activities (OS-409), gear and its mileage (OS-410) and photos (OS-412).

Editing never touches the original file: the edited fields are recorded in `edited_fields`, and a
reprocess or a later import keeps them. Changing the sport recomputes the activity's metrics.

Gear mileage is the distance of every activity using it plus the distance it had before Zankup
(`initial_m`); `limit_m` (800 km by default for shoes) turns on a warning when it is passed.

Photos are uploaded as the raw image body (the app resizes them first, so they stay well under the
4 MB limit) and re-encoded without metadata (see photos.py).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.db.models import GEAR_KINDS, Activity, Gear, Photo
from zankup.engine.run import queue_activity, queue_full, queue_user
from zankup.photos import PhotoError, get_photo_store
from zankup.sync.orchestrator import forget_on_sync

log = logging.getLogger(__name__)

router = protected_router(tags=["library"])

SPORTS = ("run", "ride", "strength", "walk", "row", "swim", "other")
MAX_PHOTO = 8 * 1024 * 1024
MAX_PHOTOS = 30


# --- editing ---------------------------------------------------------------------------------------


class ActivityEdit(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    sport: Literal["run", "ride", "strength", "walk", "row", "swim", "other"] | None = None
    gear_id: int | None = Field(default=None, description="0 removes the gear")


class EditedActivity(BaseModel):
    id: int
    name: str | None
    description: str | None
    sport: str
    gear_id: int | None
    edited_fields: list[str]


@router.patch("/api/activities/{activity_id}", operation_id="editActivity")
def edit_activity(activity_id: int, body: ActivityEdit, db: DbSession, user: CurrentUser) -> EditedActivity:
    """Change the name, description, sport or gear. Only the fields sent change."""
    activity = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.user_id == user.id))
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    edited = set(activity.edited_fields or [])
    sent = body.model_fields_set
    if "name" in sent:
        activity.name = (body.name or "").strip() or None
        edited.add("name")
    if "description" in sent:
        activity.description = (body.description or "").strip() or None
        edited.add("description")
    if "sport" in sent and body.sport is not None and body.sport != activity.sport:
        activity.sport, activity.sub_sport = body.sport, None
        edited.add("sport")
        queue_activity(db, user.id, activity.id)
    if "gear_id" in sent:
        if body.gear_id:
            _own_gear(db, user.id, body.gear_id)
        activity.gear_id = body.gear_id or None
        edited.add("gear")
    activity.edited_fields = sorted(edited) or None
    db.commit()
    return EditedActivity(
        id=activity.id,
        name=activity.name,
        description=activity.description,
        sport=activity.sport,
        gear_id=activity.gear_id,
        edited_fields=activity.edited_fields or [],
    )


@router.delete("/api/activities/{activity_id}", operation_id="deleteActivity", status_code=204)
def delete_activity(activity_id: int, db: DbSession, user: CurrentUser, settings: AppSettings) -> Response:
    """Delete an activity with everything derived from it (streams, laps, metrics, photos, shares…).

    A Garmin activity is remembered as deleted, so the next sync does not bring it back. The original
    file stays in the raw store, which is never rewritten. Records, estimates and the form are
    recomputed without it.
    """
    activity = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.user_id == user.id))
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    photos = list(db.scalars(select(Photo.key).where(Photo.activity_id == activity.id)))
    if activity.source == "garmin":
        forget_on_sync(db, user.id, activity.external_id)
    db.delete(activity)
    queue_full(db, user.id, "activity deleted")
    db.commit()
    store = get_photo_store(settings)
    for key in photos:
        try:
            store.delete(key)
        except OSError:
            log.warning("Photo file not removed", extra={"key": key})
    return Response(status_code=204)


# --- gear ------------------------------------------------------------------------------------------


class GearIn(BaseModel):
    kind: Literal["shoe", "bike", "other"] = "shoe"
    name: str = Field(min_length=1, max_length=120)
    brand: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    sports: list[Literal["run", "ride", "strength", "walk", "row", "swim", "other"]] = []
    initial_m: float = Field(default=0, ge=0, le=1e8)
    limit_m: float | None = Field(default=None, ge=0, le=1e8)


class GearUpdate(BaseModel):
    kind: Literal["shoe", "bike", "other"] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    brand: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    sports: list[Literal["run", "ride", "strength", "walk", "row", "swim", "other"]] | None = None
    initial_m: float | None = Field(default=None, ge=0, le=1e8)
    limit_m: float | None = Field(default=None, ge=0, le=1e8)
    retired: bool | None = None


class GearOut(BaseModel):
    id: int
    kind: str
    name: str
    brand: str | None
    model: str | None
    sports: list[str]
    initial_m: float
    limit_m: float | None
    retired: bool
    distance_m: float = Field(description="Activities plus initial_m")
    activities: int
    moving_s: float
    first_used: datetime | None
    last_used: datetime | None
    over_limit: bool


def _own_gear(db: DbSession, user_id: int, gear_id: int) -> Gear:
    gear = db.scalar(select(Gear).where(Gear.id == gear_id, Gear.user_id == user_id))
    if gear is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gear not found")
    return gear


def gear_list(db: DbSession, user_id: int) -> list[GearOut]:
    usage = {
        row.gear_id: row
        for row in db.execute(
            select(
                Activity.gear_id,
                func.count().label("n"),
                func.coalesce(func.sum(Activity.distance_m), 0).label("d"),
                func.coalesce(func.sum(func.coalesce(Activity.moving_s, Activity.duration_s)), 0).label(
                    "moving"
                ),
                func.min(Activity.start_utc).label("first"),
                func.max(Activity.start_utc).label("last"),
            )
            .where(Activity.user_id == user_id, Activity.gear_id.is_not(None))
            .group_by(Activity.gear_id)
        )
    }
    out = []
    for gear in db.scalars(
        select(Gear).where(Gear.user_id == user_id).order_by(Gear.retired_at.desc().nulls_first(), Gear.name)
    ):
        row = usage.get(gear.id)
        distance = (row.d if row else 0.0) + gear.initial_m
        out.append(
            GearOut(
                id=gear.id,
                kind=gear.kind,
                name=gear.name,
                brand=gear.brand,
                model=gear.model,
                sports=gear.sports or [],
                initial_m=gear.initial_m,
                limit_m=gear.limit_m,
                retired=gear.retired_at is not None,
                distance_m=distance,
                activities=row.n if row else 0,
                moving_s=row.moving if row else 0.0,
                first_used=row.first if row else None,
                last_used=row.last if row else None,
                over_limit=gear.limit_m is not None and gear.retired_at is None and distance >= gear.limit_m,
            )
        )
    return out


@router.get("/api/gear", operation_id="listGear")
def list_gear(db: DbSession, user: CurrentUser) -> list[GearOut]:
    return gear_list(db, user.id)


def _taken(db: DbSession, user_id: int, name: str, gear_id: int | None = None) -> None:
    query = select(Gear.id).where(Gear.user_id == user_id, Gear.name == name)
    if gear_id is not None:
        query = query.where(Gear.id != gear_id)
    if db.scalar(query) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "There is already gear with that name")


@router.post("/api/gear", operation_id="createGear", status_code=201)
def create_gear(body: GearIn, db: DbSession, user: CurrentUser) -> GearOut:
    name = body.name.strip()
    _taken(db, user.id, name)
    gear = Gear(
        user_id=user.id,
        kind=body.kind,
        name=name,
        brand=body.brand,
        model=body.model,
        sports=list(body.sports) or None,
        initial_m=body.initial_m,
        limit_m=body.limit_m if body.limit_m is not None else (800_000.0 if body.kind == "shoe" else None),
    )
    db.add(gear)
    db.commit()
    return next(g for g in gear_list(db, user.id) if g.id == gear.id)


@router.patch("/api/gear/{gear_id}", operation_id="updateGear")
def update_gear(gear_id: int, body: GearUpdate, db: DbSession, user: CurrentUser) -> GearOut:
    gear = _own_gear(db, user.id, gear_id)
    sent = body.model_fields_set
    if body.name is not None:
        _taken(db, user.id, body.name.strip(), gear.id)
        gear.name = body.name.strip()
    for field in ("kind", "brand", "model", "initial_m"):
        if field in sent and getattr(body, field) is not None:
            setattr(gear, field, getattr(body, field))
    if "limit_m" in sent:
        gear.limit_m = body.limit_m
    if "sports" in sent and body.sports is not None:
        gear.sports = list(body.sports) or None
    if body.retired is not None:
        gear.retired_at = datetime.now(UTC) if body.retired else None
    db.commit()
    return next(g for g in gear_list(db, user.id) if g.id == gear.id)


@router.delete("/api/gear/{gear_id}", operation_id="deleteGear", status_code=204)
def delete_gear(gear_id: int, db: DbSession, user: CurrentUser) -> Response:
    """Delete gear. Its activities keep everything else and simply have no gear."""
    gear = _own_gear(db, user.id, gear_id)
    db.execute(update(Activity).where(Activity.gear_id == gear.id).values(gear_id=None))
    db.delete(gear)
    db.commit()
    return Response(status_code=204)


# --- photos ----------------------------------------------------------------------------------------


class PhotoOut(BaseModel):
    id: int
    activity_id: int
    width: int
    height: int
    caption: str | None
    source: str


@router.post(
    "/api/activities/{activity_id}/photos",
    operation_id="addPhoto",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"image/*": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def add_photo(
    activity_id: int, request: Request, db: DbSession, user: CurrentUser, settings: AppSettings
) -> PhotoOut:
    """Add a photo (the image itself as the body). It is stored without its metadata."""
    activity = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.user_id == user.id))
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    count = db.scalar(select(func.count()).where(Photo.activity_id == activity.id)) or 0
    if count >= MAX_PHOTOS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"An activity can have up to {MAX_PHOTOS} photos")
    data = await request.body()
    if not data or len(data) > MAX_PHOTO:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Photos can be up to 8 MB")
    try:
        saved = get_photo_store(settings).save(user.id, data)
    except PhotoError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None
    photo = Photo(
        user_id=user.id,
        activity_id=activity.id,
        key=saved.key,
        width=saved.width,
        height=saved.height,
        position=count,
    )
    db.add(photo)
    db.commit()
    return PhotoOut(
        id=photo.id,
        activity_id=activity.id,
        width=photo.width,
        height=photo.height,
        caption=None,
        source=photo.source or "upload",
    )


def _own_photo(db: DbSession, user_id: int, photo_id: int) -> Photo:
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.user_id == user_id))
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return photo


@router.get(
    "/api/photos/{photo_id}",
    operation_id="getPhoto",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}}},
)
def get_photo(
    photo_id: int, db: DbSession, user: CurrentUser, settings: AppSettings, thumb: bool = False
) -> Response:
    photo = _own_photo(db, user.id, photo_id)
    try:
        data = get_photo_store(settings).read(photo.key, thumb)
    except (OSError, PhotoError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found") from None
    # Photos never change once stored: their URL can be cached for good.
    return Response(
        data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"}
    )


@router.delete("/api/photos/{photo_id}", operation_id="deletePhoto", status_code=204)
def delete_photo(photo_id: int, db: DbSession, user: CurrentUser, settings: AppSettings) -> Response:
    photo = _own_photo(db, user.id, photo_id)
    db.delete(photo)
    db.commit()
    get_photo_store(settings).delete(photo.key)
    return Response(status_code=204)


def photos_of(db: DbSession, activity_id: int) -> list[PhotoOut]:
    return [
        PhotoOut(
            id=p.id,
            activity_id=p.activity_id,
            width=p.width,
            height=p.height,
            caption=p.caption,
            source=p.source,
        )
        for p in db.scalars(
            select(Photo).where(Photo.activity_id == activity_id).order_by(Photo.position, Photo.id)
        )
    ]


_ = (GEAR_KINDS, SPORTS, queue_user)
