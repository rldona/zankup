"""Sharing an activity (OS-408): public, expiring links, and what a share image is drawn from.

A link is `/s/<token>`: 32 random bytes, of which only the SHA-256 is stored, valid until it expires
(1 to 365 days, or until revoked when no expiry is chosen). What it shows is `SharedActivity`: the
summary, splits, an elevation and pace profile and, if chosen, the route **with the privacy zones
removed** (OS-407). Never the heart rate series, the original file, the device or the exact time of
day. Photos are served through the link too; they never carry EXIF (OS-412).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.db.models import Activity, Photo, ShareLink, Stream, User
from zankup.fit.streams import decode_polyline, decode_streams
from zankup.photos import PhotoError, get_photo_store
from zankup.privacy import mask, trim, zones_of

router = protected_router(tags=["sharing"])
public = APIRouter(prefix="/api/public", tags=["sharing"])

PROFILE_POINTS = 300


class ShareCreate(BaseModel):
    days: int | None = Field(default=7, ge=1, le=365, description="Null: valid until revoked")
    show_map: bool = True


class ShareOut(BaseModel):
    id: int
    activity_id: int
    path: str | None = Field(description="Only when created: /s/<token>. The token is not kept.")
    show_map: bool
    expires_at: datetime | None
    created_at: datetime
    views: int


class ProfilePoint(BaseModel):
    distance_m: float
    altitude_m: float | None
    speed: float | None


class SharedSplit(BaseModel):
    distance_m: float
    time_s: float
    elevation_change_m: float | None


class SharedPhoto(BaseModel):
    id: int
    width: int
    height: int
    caption: str | None


class SharedActivity(BaseModel):
    name: str | None
    sport: str
    sub_sport: str | None
    day: str = Field(description="Local date (YYYY-MM-DD); the time of day is not shared")
    athlete: str | None
    duration_s: float
    moving_s: float | None
    distance_m: float | None
    ascent_m: float | None
    avg_hr: int | None
    avg_power: int | None
    route: list[list[tuple[float, float]]] | None = Field(
        description="Stretches of [lat, lon] outside the privacy zones; null without a map"
    )
    profile: list[ProfilePoint]
    splits: list[SharedSplit]
    photos: list[SharedPhoto]
    expires_at: datetime | None = None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _out(link: ShareLink, path: str | None = None) -> ShareOut:
    return ShareOut(
        id=link.id,
        activity_id=link.activity_id,
        path=path,
        show_map=link.show_map,
        expires_at=link.expires_at,
        created_at=link.created_at,
        views=link.views,
    )


def _profile(data: bytes | None, zones: list[dict[str, Any]]) -> list[ProfilePoint]:
    if data is None:
        return []
    series = decode_streams(data)
    dist = series.get("dist") or []
    if not dist:
        return []
    alt = series.get("alt") or [None] * len(dist)
    speed = series.get("speed") or [None] * len(dist)
    step = max(1, len(dist) // PROFILE_POINTS)
    return [
        ProfilePoint(distance_m=dist[i], altitude_m=alt[i], speed=speed[i])
        for i in range(0, len(dist), step)
        if dist[i] is not None
    ]


def shared_view(db: DbSession, activity: Activity, show_map: bool) -> SharedActivity:
    """What anyone with the link sees, privacy applied."""
    zones = zones_of(db, activity.user_id)
    route = None
    if show_map and activity.route_simplified:
        route = [
            [(round(a, 5), round(o, 5)) for a, o in s]
            for s in trim(decode_polyline(activity.route_simplified), zones)
        ]
    from zankup.engine.user import local_day

    owner = db.get(User, activity.user_id)
    photos = db.scalars(
        select(Photo).where(Photo.activity_id == activity.id).order_by(Photo.position, Photo.id)
    )
    return SharedActivity(
        name=activity.name,
        sport=activity.sport,
        sub_sport=activity.sub_sport,
        day=local_day(activity.start_utc, activity.timezone).isoformat(),
        athlete=owner.display_name if owner else None,
        duration_s=activity.duration_s,
        moving_s=activity.moving_s,
        distance_m=activity.distance_m,
        ascent_m=activity.ascent_m,
        avg_hr=activity.avg_hr,
        avg_power=activity.avg_power,
        route=route,
        profile=_profile(db.scalar(select(Stream.data).where(Stream.activity_id == activity.id)), zones),
        splits=[
            SharedSplit(
                distance_m=s["distance_m"], time_s=s["time_s"], elevation_change_m=s.get("elevation_change_m")
            )
            for s in activity.splits or []
        ],
        photos=[SharedPhoto(id=p.id, width=p.width, height=p.height, caption=p.caption) for p in photos],
    )


def positions(
    lat: list[float | None], lon: list[float | None], zones: list[dict[str, Any]]
) -> tuple[list[float | None], list[float | None]]:
    return mask(lat, lon, zones)


def _own(db: DbSession, user: CurrentUser, activity_id: int) -> Activity:
    activity = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.user_id == user.id))
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    return activity


@router.get("/api/activities/{activity_id}/shared", operation_id="previewSharedActivity")
def preview(activity_id: int, db: DbSession, user: CurrentUser, show_map: bool = True) -> SharedActivity:
    """What a share link (or share image) of this activity shows, privacy zones applied."""
    return shared_view(db, _own(db, user, activity_id), show_map)


@router.post("/api/activities/{activity_id}/shares", operation_id="createShare", status_code=201)
def create_share(activity_id: int, body: ShareCreate, db: DbSession, user: CurrentUser) -> ShareOut:
    activity = _own(db, user, activity_id)
    token = secrets.token_urlsafe(32)
    link = ShareLink(
        user_id=user.id,
        activity_id=activity.id,
        token_hash=_hash(token),
        show_map=body.show_map,
        expires_at=datetime.now(UTC) + timedelta(days=body.days) if body.days else None,
    )
    db.add(link)
    db.commit()
    return _out(link, f"/s/{token}")


@router.get("/api/activities/{activity_id}/shares", operation_id="listShares")
def list_shares(activity_id: int, db: DbSession, user: CurrentUser) -> list[ShareOut]:
    _own(db, user, activity_id)
    now = datetime.now(UTC)
    links = db.scalars(
        select(ShareLink)
        .where(
            ShareLink.activity_id == activity_id, ShareLink.user_id == user.id, ShareLink.revoked_at.is_(None)
        )
        .order_by(ShareLink.created_at.desc())
    )
    return [_out(link) for link in links if link.expires_at is None or link.expires_at > now]


@router.delete("/api/shares/{share_id}", operation_id="revokeShare", status_code=204)
def revoke_share(share_id: int, db: DbSession, user: CurrentUser) -> Response:
    link = db.scalar(select(ShareLink).where(ShareLink.id == share_id, ShareLink.user_id == user.id))
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    link.revoked_at = datetime.now(UTC)
    db.commit()
    return Response(status_code=204)


def _link(db: DbSession, token: str) -> ShareLink:
    link = db.scalar(select(ShareLink).where(ShareLink.token_hash == _hash(token)))
    now = datetime.now(UTC)
    if (
        link is None
        or link.revoked_at is not None
        or (link.expires_at is not None and link.expires_at <= now)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link has expired or does not exist")
    return link


@public.get("/shares/{token}", operation_id="getSharedActivity")
def shared(token: str, db: DbSession) -> SharedActivity:
    """A shared activity, for anyone with the link."""
    link = _link(db, token)
    activity = db.get_one(Activity, link.activity_id)
    db.execute(update(ShareLink).where(ShareLink.id == link.id).values(views=ShareLink.views + 1))
    db.commit()
    view = shared_view(db, activity, link.show_map)
    view.expires_at = link.expires_at
    return view


@public.get(
    "/shares/{token}/photos/{photo_id}",
    operation_id="getSharedPhoto",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}}},
)
def shared_photo(
    token: str, photo_id: int, db: DbSession, settings: AppSettings, thumb: bool = Query(default=False)
) -> Response:
    link = _link(db, token)
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.activity_id == link.activity_id))
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    try:
        data = get_photo_store(settings).read(photo.key, thumb)
    except (OSError, PhotoError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found") from None
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
