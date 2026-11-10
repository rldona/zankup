"""Milestone 4: TCX/GPX, imports (files and a Strava export), sharing with privacy zones, editing,
gear, photos, exports, push notifications and the review."""

from __future__ import annotations

import base64
import csv
import io
import json
import struct
import zipfile
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image
from sqlalchemy import func, select

from tests.test_activities import SETTINGS, Ctx, ctx  # noqa: F401
from tests.test_engine import drain
from zankup.core.config import Settings, get_settings
from zankup.db.models import Activity, BestEffort, Gear, ImportRow, Job, Photo, PushSubscription, UserSettings
from zankup.fit.files import parse_file
from zankup.fit.streams import decode_polyline
from zankup.importer import Importer, strava_date
from zankup.ingest import default_gear, ingest_file
from zankup.jobs.handlers import default_handlers
from zankup.jobs.worker import Worker
from zankup.notify import _hkdf, encrypt, message, notify, vapid_header, vapid_key
from zankup.photos import PhotoStore
from zankup.privacy import trim

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def m4(ctx: Ctx, tmp_path: Path) -> Iterator[tuple[Ctx, Settings]]:  # noqa: F811
    """The activities context with a data directory of its own (photos, uploads, exports)."""
    settings = SETTINGS.model_copy(update={"data_dir": tmp_path / "data"})
    app: Any = ctx.http.app
    app.dependency_overrides[get_settings] = lambda: settings
    yield ctx, settings


def run_jobs(context: Ctx, settings: Settings) -> int:
    worker = Worker(context.sessions, default_handlers(context.store, context.sessions, None, None, settings))
    from sqlalchemy import update

    from zankup.jobs.queue import now

    done = 0
    while True:
        with context.sessions.begin() as db:
            db.execute(update(Job).where(Job.status == "queued").values(run_after=now()))
        if not worker.run_once():
            return done
        done += 1


def owner_id(context: Ctx) -> int:
    with context.sessions() as db:
        return db.get_one(Activity, context.ids["run"]).user_id


def jpeg_with_gps() -> bytes:
    image = Image.new("RGB", (64, 48), (200, 50, 50))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # camera make
    exif[0x8825] = {1: "N", 2: (40.0, 33.0, 0.0)}  # a GPS position
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif)
    return out.getvalue()


# --- TCX and GPX ------------------------------------------------------------------------------------


def test_tcx_and_gpx_become_activities() -> None:
    tcx = parse_file((FIXTURES / "tcx" / "run-2019-strava.tcx").read_bytes(), "tcx")
    assert tcx.sport == "run" and tcx.start_utc.year == 2020 and tcx.has_gps
    assert tcx.distance_m and tcx.distance_m > 0 and not tcx.distance_from_gps
    assert tcx.avg_hr and tcx.max_hr and len(tcx.streams) == 300
    gpx = parse_file((FIXTURES / "gpx" / "ride-2012-strava.gpx").read_bytes(), "gpx")
    assert gpx.has_gps and gpx.distance_from_gps and gpx.distance_m and gpx.distance_m > 1000
    assert gpx.streams.dist[-1] == gpx.distance_m and any(s is not None for s in gpx.streams.speed)


def test_xml_with_a_dtd_is_refused() -> None:
    from zankup.fit.parser import FitParseError

    bomb = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><gpx><trk></trk></gpx>'
    with pytest.raises(FitParseError):
        parse_file(bomb, "gpx")


def test_strava_dates_in_both_languages() -> None:
    assert strava_date("27 oct 2026, 17:21:00") == datetime(2026, 10, 27, 17, 21, tzinfo=UTC)
    assert strava_date("6 sept 2021, 7:40:40") == datetime(2021, 9, 6, 7, 40, 40, tzinfo=UTC)
    assert strava_date("Oct 27, 2026, 5:21:00 PM") == datetime(2026, 10, 27, 17, 21, tzinfo=UTC)
    assert strava_date("Jan 1, 2020, 12:05:00 AM") == datetime(2020, 1, 1, 0, 5, tzinfo=UTC)
    assert strava_date("yesterday") is None


# --- a Strava export --------------------------------------------------------------------------------


def _row(**values: str) -> list[str]:
    from zankup.importer import COL

    row = [""] * 104
    for name, value in values.items():
        row[COL[name]] = value
    return row


def _csv(rows: list[list[str]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["ID de actividad", *[f"c{i}" for i in range(1, 104)]])
    writer.writerows(rows)
    return out.getvalue()


def strava_export(run_start: datetime) -> bytes:
    """A small export: one run that Garmin already has, a GPX ride, a TCX run and a manual session."""

    months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"]

    def stamp(d: datetime) -> str:
        return f"{d.day} {months[d.month - 1]} {d.year}, {d:%H:%M:%S}"

    rows = [
        _row(
            id="111",
            date=stamp(run_start + timedelta(seconds=40)),
            name="Morning loop",
            type="Carrera",
            description="Easy",
            gear="New Balance fresh foam New Balance Fresh Foam",
            file="activities/111.fit.gz",
            relative_effort="42.0",
            calories="400.0",
            grade_adjusted_distance="6100.0",
            weather_condition="Clear",
            weather_temperature="12.5",
            media="media/a.jpg|media/clip.mp4",
        ),
        _row(
            id="222",
            date="1 ene 2012, 10:00:00",
            name="Old ride",
            type="Bicicleta",
            file="activities/222.gpx",
            gear="Canyon Aeroad",
        ),
        _row(
            id="333",
            date="2 ene 2019, 10:00:00",
            name="Old run",
            type="Carrera",
            file="activities/333.tcx.gz",
        ),
        _row(
            id="444",
            date="3 ene 2019, 18:00:00",
            name="Gym",
            type="Entrenamiento con pesas",
            elapsed="3600.0",
            moving="3000.0",
            calories="250.0",
        ),
    ]
    import gzip

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("export_1/activities.csv", _csv(rows))
        archive.writestr(
            "export_1/shoes.csv",
            "Nombre de las zapatillas,Marca,Modelo,Deportes\n"
            "New Balance Fresh Foam,New Balance,fresh foam,Carrera\n",
        )
        archive.writestr(
            "export_1/bikes.csv", "Nombre,Marca,Modelo,Deportes\nCanyon Aeroad,Canyon,CFR,Bicicleta\n"
        )
        archive.writestr(
            "export_1/privacy_zones.csv",
            'Dirección,Radio,Latitud y longitud\n"Home","1,00 kilómetro","51.5073, -0.1657"\n',
        )
        archive.writestr("export_1/media.csv", "Nombre del archivo,Título\nmedia/a.jpg,At the finish\n")
        archive.writestr("export_1/media/a.jpg", jpeg_with_gps())
        archive.writestr("export_1/media/clip.mp4", b"not a photo")
        archive.writestr(
            "export_1/activities/111.fit.gz", gzip.compress((FIXTURES / "fit" / "run.fit").read_bytes())
        )
        archive.writestr(
            "export_1/activities/222.gpx", (FIXTURES / "gpx" / "ride-2012-strava.gpx").read_bytes()
        )
        archive.writestr(
            "export_1/activities/333.tcx.gz",
            gzip.compress((FIXTURES / "tcx" / "run-2019-strava.tcx").read_bytes()),
        )
    return out.getvalue()


def test_strava_export_merges_with_garmin_and_imports_the_rest(
    m4: tuple[Ctx, Settings], tmp_path: Path
) -> None:
    context, settings = m4
    user_id = owner_id(context)
    with context.sessions() as db:
        run_start = db.get_one(Activity, context.ids["run"]).start_utc
    path = tmp_path / "export.zip"
    path.write_bytes(strava_export(run_start))
    photos = PhotoStore(settings.data_dir / "photos")
    importer = Importer(context.sessions, context.store, photos, user_id)
    assert importer.run(path, "export.zip") == "strava"
    counts = importer.counts
    assert (counts.total, counts.merged, counts.created, counts.failed) == (4, 1, 3, 0), counts.errors
    assert counts.photos == 1  # the video is not a photo
    with context.sessions() as db:
        run = db.get_one(Activity, context.ids["run"])
        assert run.source == "garmin" and run.name == "Morning loop" and run.description == "Easy"
        assert (
            run.strava
            and run.strava["relative_effort"] == 42
            and run.strava["weather"]["condition"] == "Clear"
        )
        shoe = db.scalar(select(Gear).where(Gear.name == "New Balance Fresh Foam"))
        assert (
            shoe is not None and run.gear_id == shoe.id and shoe.sports == ["run"] and shoe.limit_m == 800_000
        )
        ride = db.scalar(select(Activity).where(Activity.source == "strava", Activity.external_id == "222"))
        assert ride is not None and ride.sport == "ride" and ride.fit_path and ride.fit_path.endswith(".gpx")
        assert ride.gear_id is not None
        assert db.scalar(select(func.count()).where(BestEffort.activity_id == ride.id)) == 0
        old_run = db.scalar(select(Activity).where(Activity.external_id == "333"))
        assert old_run is not None and old_run.gear_id is None  # no gear on Strava: no default either
        gym = db.scalar(select(Activity).where(Activity.external_id == "444"))
        assert gym is not None and gym.sport == "strength" and gym.fit_path is None and gym.duration_s == 3600
        photo = db.scalar(select(Photo).where(Photo.activity_id == run.id))
        assert photo is not None and photo.caption == "At the finish" and photo.source == "strava"
        zones = db.get_one(UserSettings, user_id).privacy_zones
        assert zones and zones[0]["radius_m"] == 1000
    with Image.open(photos.path(photo.key)) as stored:
        assert not stored.getexif()  # no camera, no GPS
    again = Importer(context.sessions, context.store, photos, user_id)
    again.run(path, "export.zip")
    assert again.counts.skipped == 4 and again.counts.created == again.counts.merged == 0


def test_a_garmin_fit_takes_over_an_activity_from_strava(ctx: Ctx) -> None:  # noqa: F811
    user_id = owner_id(ctx)
    data = (FIXTURES / "fit" / "run.fit").read_bytes()
    with ctx.sessions.begin() as db:
        db.delete(db.get_one(Activity, ctx.ids["run"]))
    with ctx.sessions.begin() as db:
        first = ingest_file(
            db, ctx.store, user_id=user_id, source="strava", external_id="9", data=data, name="Mine"
        )
        db.get_one(Activity, first.activity_id).edited_fields = ["name"]
    with ctx.sessions.begin() as db:
        second = ingest_file(db, ctx.store, user_id=user_id, source="garmin", external_id="g1", data=data)
        assert second.merged and second.activity_id == first.activity_id
        activity = db.get_one(Activity, first.activity_id)
        assert activity.source == "garmin" and activity.external_id == "g1" and activity.name == "Mine"


def test_loose_files_and_nested_zips_are_imported_once(m4: tuple[Ctx, Settings], tmp_path: Path) -> None:
    context, _settings = m4
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as archive:
        archive.writestr("ride.gpx", (FIXTURES / "gpx" / "ride-2012-strava.gpx").read_bytes())
    outer = tmp_path / "garmin.zip"
    with zipfile.ZipFile(outer, "w") as archive:
        archive.writestr("DI_CONNECT/uploaded.zip", inner.getvalue())
        archive.writestr("a/run.fit", (FIXTURES / "fit" / "run.fit").read_bytes())  # Garmin already has it
        archive.writestr("a/broken.fit", b"not a fit file")
        archive.writestr("notes.txt", b"ignored")
    importer = Importer(context.sessions, context.store, PhotoStore(tmp_path / "p"), owner_id(context))
    assert importer.run(outer, "garmin.zip") == "archive"
    assert (importer.counts.created, importer.counts.skipped, importer.counts.failed) == (1, 1, 1)
    again = Importer(context.sessions, context.store, PhotoStore(tmp_path / "p"), owner_id(context))
    again.run(outer, "garmin.zip")
    assert again.counts.created == 0 and again.counts.skipped == 2


# --- uploads ---------------------------------------------------------------------------------------


def test_an_upload_in_parts_is_imported_by_the_worker(m4: tuple[Ctx, Settings]) -> None:
    context, _settings = m4
    data = (FIXTURES / "tcx" / "run-2019-strava.tcx").read_bytes()
    created = context.http.post("/api/imports", json={"filename": "run.tcx", "size": len(data)}).json()
    upload, row = created["upload"], created["import"]
    assert row["status"] == "uploading" and upload["url"].endswith(f"/api/direct/uploads/{row['id']}")
    assert context.http.post(f"/api/imports/{row['id']}/finish").status_code == 409  # nothing yet
    bad = context.http.put(f"{upload['url']}/0", params={"token": "nope"}, content=data)
    assert bad.status_code == 401
    context.http.cookies.clear()  # the part needs no session, only the token
    part = context.http.put(f"{upload['url']}/0", params={"token": upload["token"]}, content=data)
    assert part.status_code == 204, part.text
    short = context.http.put(f"{upload['url']}/0", params={"token": upload["token"]}, content=data[:10])
    assert short.status_code == 400


def test_upload_finish_queues_the_import(m4: tuple[Ctx, Settings]) -> None:
    context, settings = m4
    data = (FIXTURES / "tcx" / "run-2019-strava.tcx").read_bytes()
    created = context.http.post("/api/imports", json={"filename": "run.tcx", "size": len(data)}).json()
    upload, import_id = created["upload"], created["import"]["id"]
    assert (
        context.http.put(f"{upload['url']}/0", params={"token": upload["token"]}, content=data).status_code
        == 204
    )
    assert context.http.post(f"/api/imports/{import_id}/finish").json()["status"] == "queued"
    run_jobs(context, settings)
    done = context.http.get(f"/api/imports/{import_id}").json()
    assert done["status"] == "done" and done["kind"] == "file" and done["created"] == 1, done
    assert not (settings.data_dir / "uploads" / f"{import_id}.upload").exists()


# --- sharing and privacy ---------------------------------------------------------------------------


def test_trim_splits_the_route_around_a_zone() -> None:
    line = [(51.5, -0.1 + i * 0.001) for i in range(20)]  # ~70 m apart, west to east
    zone = {"lat": 51.5, "lon": -0.1 + 10 * 0.001, "radius_m": 100}
    stretches = trim(line, [zone])
    assert len(stretches) == 2 and all(len(s) > 1 for s in stretches)
    assert sum(len(s) for s in stretches) < len(line)


def test_a_share_link_hides_the_privacy_zone_and_expires(m4: tuple[Ctx, Settings]) -> None:
    context, _ = m4
    run_id = context.ids["run"]
    with context.sessions() as db:
        start = decode_polyline(db.get_one(Activity, run_id).route_simplified or "")[0]
    zone = {"id": "home", "name": "Home", "lat": start[0], "lon": start[1], "radius_m": 200}
    assert context.http.patch("/api/settings", json={"privacy_zones": [zone]}).status_code == 200
    link = context.http.post(f"/api/activities/{run_id}/shares", json={"days": 7, "show_map": True}).json()
    token = link["path"].removeprefix("/s/")
    context.http.cookies.clear()
    shared = context.http.get(f"/api/public/shares/{token}").json()
    assert shared["name"] and shared["distance_m"] > 0 and shared["profile"]
    points = [p for stretch in shared["route"] for p in stretch]
    from zankup.privacy import distance

    assert points and min(distance(tuple(p), start) for p in points) > 200  # type: ignore[arg-type]
    assert "device" not in shared and "start_utc" not in shared
    assert context.http.get("/api/public/shares/wrong").status_code == 404
    with context.sessions.begin() as db:
        from zankup.db.models import ShareLink

        db.get_one(ShareLink, link["id"]).expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert context.http.get(f"/api/public/shares/{token}").status_code == 404


def test_revoked_links_and_hidden_maps(ctx: Ctx) -> None:  # noqa: F811
    run_id = ctx.ids["run"]
    link = ctx.http.post(f"/api/activities/{run_id}/shares", json={"days": None, "show_map": False}).json()
    assert link["expires_at"] is None
    token = link["path"].removeprefix("/s/")
    assert ctx.http.get(f"/api/public/shares/{token}").json()["route"] is None
    assert [s["id"] for s in ctx.http.get(f"/api/activities/{run_id}/shares").json()] == [link["id"]]
    assert ctx.http.delete(f"/api/shares/{link['id']}").status_code == 204
    assert ctx.http.get(f"/api/public/shares/{token}").status_code == 404
    assert ctx.http.post(f"/api/activities/{ctx.other_id}/shares", json={}).status_code == 404


# --- editing, gear and photos ----------------------------------------------------------------------


def test_editing_keeps_the_original_and_survives_a_reprocess(ctx: Ctx) -> None:  # noqa: F811
    run_id = ctx.ids["run"]
    gear = ctx.http.post("/api/gear", json={"name": "Old shoes", "kind": "shoe", "initial_m": 100_000}).json()
    edited = ctx.http.patch(
        f"/api/activities/{run_id}", json={"name": "  Hills  ", "sport": "walk", "gear_id": gear["id"]}
    ).json()
    assert edited["name"] == "Hills" and edited["sport"] == "walk"
    assert edited["edited_fields"] == ["gear", "name", "sport"]
    with ctx.sessions.begin() as db:
        activity = db.get_one(Activity, run_id)
        ingest_file(db, ctx.store, user_id=activity.user_id, source="garmin", external_id="run",
                    data=ctx.store.get(activity.fit_path or ""), reprocess=True)  # fmt: skip
    detail = ctx.http.get(f"/api/activities/{run_id}").json()
    assert detail["sport"] == "walk" and detail["name"] == "Hills" and detail["gear"]["name"] == "Old shoes"
    shoes = next(g for g in ctx.http.get("/api/gear").json() if g["id"] == gear["id"])
    assert shoes["activities"] == 1 and shoes["distance_m"] == pytest.approx(100_000 + detail["distance_m"])
    assert shoes["limit_m"] == 800_000 and not shoes["over_limit"]
    over = ctx.http.patch(f"/api/gear/{gear['id']}", json={"limit_m": 50_000}).json()
    assert over["over_limit"]
    assert ctx.http.patch(f"/api/activities/{ctx.other_id}", json={"name": "x"}).status_code == 404
    assert ctx.http.delete(f"/api/gear/{gear['id']}").status_code == 204
    assert ctx.http.get(f"/api/activities/{run_id}").json()["gear"] is None


def test_new_activities_get_the_default_gear(ctx: Ctx) -> None:  # noqa: F811
    gear = ctx.http.post("/api/gear", json={"name": "Bike", "kind": "bike", "sports": ["ride"]}).json()
    assert gear["limit_m"] is None
    with ctx.sessions.begin() as db:
        result = ingest_file(db, ctx.store, user_id=owner_id(ctx), source="file", external_id="ride",
                             data=(FIXTURES / "fit" / "ride-power.fit").read_bytes())  # fmt: skip
        assert db.get_one(Activity, result.activity_id).gear_id == gear["id"]


def test_photos_are_stored_without_metadata(m4: tuple[Ctx, Settings]) -> None:
    context, _settings = m4
    run_id = context.ids["run"]
    added = context.http.post(
        f"/api/activities/{run_id}/photos", content=jpeg_with_gps(), headers={"Content-Type": "image/jpeg"}
    )
    assert added.status_code == 201, added.text
    photo = added.json()
    image = context.http.get(f"/api/photos/{photo['id']}")
    assert image.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(image.content)) as stored:
        assert not stored.getexif() and stored.size == (64, 48)
    assert context.http.get(f"/api/photos/{photo['id']}", params={"thumb": True}).status_code == 200
    card = next(i for i in context.http.get("/api/activities").json()["items"] if i["id"] == run_id)
    assert card["photo"] == photo["id"] and card["photos"] == 1
    bad = context.http.post(
        f"/api/activities/{run_id}/photos", content=b"text", headers={"Content-Type": "image/jpeg"}
    )
    assert bad.status_code == 422
    assert context.http.delete(f"/api/photos/{photo['id']}").status_code == 204
    assert context.http.get(f"/api/photos/{photo['id']}").status_code == 404


# --- export ----------------------------------------------------------------------------------------


def test_export_has_the_originals_and_the_data(m4: tuple[Ctx, Settings]) -> None:
    context, settings = m4
    export = context.http.post("/api/exports").json()
    assert export["status"] == "queued" and context.http.post("/api/exports").json()["id"] == export["id"]
    run_jobs(context, settings)
    done = context.http.get("/api/exports").json()[0]
    assert done["status"] == "done" and done["download_url"], done
    context.http.cookies.clear()
    response = context.http.get(done["download_url"])
    assert response.status_code == 200 and response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        activities = json.loads(archive.read("activities.json"))
        profile = json.loads(archive.read("profile.json"))
    assert {"README.txt", "gear.json", "settings.json"} <= names
    assert len(activities) == 3 and all(a["original"] in names for a in activities)
    assert "password_hash" not in profile and profile["email"] == "runner@example.com"
    url = done["download_url"].replace("token=", "token=x")
    assert context.http.get(url).status_code == 401


# --- push notifications ----------------------------------------------------------------------------


def _decrypt(body: bytes, private: ec.EllipticCurvePrivateKey, auth: bytes) -> bytes:
    """What the browser does (RFC 8291), to check our encryption."""
    salt, (rs, idlen) = body[:16], struct.unpack("!IB", body[16:21])
    sender = body[21 : 21 + idlen]
    ciphertext = body[21 + idlen :]
    ua_public = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    shared = private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender))
    ikm = _hkdf(auth, shared, b"WebPush: info\x00" + ua_public + sender, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert rs == 4096 and plain.endswith(b"\x02")
    return plain[:-1]


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_web_push_payloads_decrypt_like_a_browser() -> None:
    browser = ec.generate_private_key(ec.SECP256R1())
    public = browser.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    auth = b"0123456789abcdef"
    body = encrypt(b'{"title":"Hi"}', _b64(public), _b64(auth))
    assert _decrypt(body, browser, auth) == b'{"title":"Hi"}'


def test_vapid_key_is_kept_and_signs(tmp_path: Path) -> None:
    import jwt

    settings = SETTINGS.model_copy(update={"data_dir": tmp_path})
    key = vapid_key(settings)
    assert vapid_key(settings).private_numbers() == key.private_numbers()  # generated once, then read
    header = vapid_header(key, "https://push.example.com/abc", "mailto:me@example.com")
    token = header.split("t=")[1].split(",")[0]
    claims = jwt.decode(token, key.public_key(), algorithms=["ES256"], audience="https://push.example.com")
    assert claims["sub"] == "mailto:me@example.com"


def test_notifications_follow_the_preferences_and_drop_dead_subscriptions(
    m4: tuple[Ctx, Settings], monkeypatch: pytest.MonkeyPatch
) -> None:
    context, settings = m4
    user_id = owner_id(context)
    assert context.http.get("/api/notifications/key").json()["public_key"]
    browser = ec.generate_private_key(ec.SECP256R1())
    public = browser.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    sub = {
        "endpoint": "https://push.example.com/1",
        "keys": {"p256dh": _b64(public), "auth": _b64(b"a" * 16)},
    }
    assert context.http.post("/api/notifications/subscriptions", json=sub).status_code == 201
    with context.sessions.begin() as db:
        assert not notify(db, user_id, "estimate", {"kind": "ftp", "value": 250}, key="e1")  # off by default
        assert notify(
            db, user_id, "record", {"activity_id": 1, "distance_key": "5k", "time_s": 1500}, key="r1"
        )
        assert not notify(db, user_id, "record", {"activity_id": 1}, key="r1")  # once
    sent: list[dict[str, Any]] = []

    class Answer:
        status_code = 201

    def post(url: str, content: bytes, headers: dict[str, str], timeout: float) -> Answer:
        sent.append({"url": url, "body": content, "headers": headers})
        return Answer()

    monkeypatch.setattr("zankup.notify.httpx.post", post)
    run_jobs(context, settings)
    assert len(sent) == 1 and sent[0]["headers"]["Content-Encoding"] == "aes128gcm"
    payload = json.loads(_decrypt(sent[0]["body"], browser, b"a" * 16))
    assert (
        payload["title"] == "New record" and payload["url"] == "/activities/1" and "25:00" in payload["body"]
    )
    context.http.patch("/api/settings", json={"language": "es"})
    Answer.status_code = 410
    assert context.http.post("/api/notifications/test").status_code == 409
    with context.sessions() as db:
        assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0


def test_messages_are_in_the_users_language() -> None:
    record = message("record", {"activity_id": 3, "distance_key": "10k", "time_s": 3001}, "es")
    assert record["title"] == "Nuevo récord" and "10 km en 50:01" in record["body"]
    imported = message("import", {"created": 5, "merged": 2}, "en")
    assert imported["body"] == "5 new activities, 2 merged"
    assert message("import", {"error": True}, "en")["title"] == "Import failed"


def test_the_garmin_key_warning_comes_once_two_weeks_before(ctx: Ctx) -> None:  # noqa: F811
    from zankup.jobs.scheduler import Scheduler

    with ctx.sessions.begin() as db:
        db.add(PushSubscription(user_id=owner_id(ctx), endpoint="https://p/1", p256dh="x", auth="y"))
    today = datetime(2026, 11, 9, 12, tzinfo=UTC)
    scheduler = Scheduler(ctx.sessions, interval=None, owner_email="runner@example.com",
                          garmin_key_expires_on=date(2026, 11, 30))  # fmt: skip
    scheduler.tick(today)  # 21 days left
    scheduler.tick(today + timedelta(days=8))  # 13 days left
    scheduler.tick(today + timedelta(days=9))
    with ctx.sessions() as db:
        jobs = db.scalars(select(Job).where(Job.kind == "push")).all()
        assert [j.payload["kind"] for j in jobs] == ["garmin_key"]


# --- review and comparison -------------------------------------------------------------------------


def test_month_and_year_in_review(ctx: Ctx) -> None:  # noqa: F811
    drain(ctx)
    with ctx.sessions() as db:
        start = db.get_one(Activity, ctx.ids["run"]).start_utc
    month = ctx.http.get("/api/stats/review", params={"period": "month", "value": f"{start:%Y-%m}"}).json()
    assert month["totals"]["count"] == 3 and month["active_days"] >= 1 and month["longest"]["id"]
    assert len(month["buckets"]) in (28, 29, 30, 31)
    year = ctx.http.get("/api/stats/review", params={"period": "year", "value": str(start.year)}).json()
    assert len(year["buckets"]) == 12 and year["totals"]["count"] == 3
    assert ctx.http.get("/api/stats/review", params={"period": "month", "value": "nope"}).status_code == 400


def test_strava_comparison_measures_how_close_we_are(ctx: Ctx) -> None:  # noqa: F811
    drain(ctx)
    with ctx.sessions.begin() as db:
        for activity_id in ctx.ids.values():
            activity = db.get_one(Activity, activity_id)
            activity.strava = {"id": str(activity_id), "relative_effort": 50.0, "calories": 300.0}
    comparison = ctx.http.get("/api/stats/strava-comparison").json()
    effort = next(m for m in comparison["metrics"] if m["metric"] == "effort")
    assert effort["count"] >= 2 and effort["mae"] is not None and len(effort["largest"]) == effort["count"]
    assert comparison["effort_scale"] is None  # too few activities to fit a scale


def test_least_squares_recovers_a_known_scale() -> None:
    from zankup.api.review import least_squares, r_squared

    truth = [0.5, 1.0, 2.0, 3.5, 5.0]
    rows = [[(i * 7 + j * 3) % 11 + j for j in range(5)] for i in range(30)]
    targets = [sum(c * x for c, x in zip(truth, r, strict=True)) for r in rows]
    fitted = least_squares([[float(x) for x in r] for r in rows], targets)
    assert fitted is not None and all(abs(a - b) < 1e-6 for a, b in zip(fitted, truth, strict=True))
    assert r_squared(targets, targets) == 1


def test_the_import_row_counts_are_saved(m4: tuple[Ctx, Settings], tmp_path: Path) -> None:
    context, _settings = m4
    from zankup.importer import run_import

    path = tmp_path / "upload"
    path.write_bytes(b"neither zip nor activity")
    with context.sessions.begin() as db:
        row = ImportRow(user_id=owner_id(context), filename="notes.txt", size=10, status="queued")
        db.add(row)
    run_import(context.sessions, context.store, PhotoStore(tmp_path / "p"), row.id, path)
    with context.sessions() as db:
        saved = db.get_one(ImportRow, row.id)
        assert saved.status == "error" and saved.error and "FIT" in saved.error


def test_an_interrupted_import_resumes_with_its_counts(m4: tuple[Ctx, Settings], tmp_path: Path) -> None:
    context, settings = m4
    from zankup.importer import run_import

    with context.sessions() as db:
        run_start = db.get_one(Activity, context.ids["run"]).start_utc
    photos = PhotoStore(settings.data_dir / "photos")
    path = tmp_path / "export.zip"
    path.write_bytes(strava_export(run_start))
    first = Importer(context.sessions, context.store, photos, owner_id(context))
    first.run(path, "export.zip")  # as if it had done everything, then the process stopped
    with context.sessions.begin() as db:
        row = ImportRow(
            user_id=owner_id(context),
            filename="export.zip",
            size=1,
            status="running",
            started_at=datetime.now(UTC),
            created=first.counts.created,
            merged=first.counts.merged,
            photos=first.counts.photos,
        )
        db.add(row)
    run_import(context.sessions, context.store, photos, row.id, path)
    with context.sessions() as db:
        saved = db.get_one(ImportRow, row.id)
        assert (saved.status, saved.kind, saved.created, saved.merged, saved.skipped) == (
            "done",
            "strava",
            3,
            1,
            0,
        )


def test_a_strava_upload_imports_through_the_job(m4: tuple[Ctx, Settings], tmp_path: Path) -> None:
    context, settings = m4
    from zankup.importer import run_import

    with context.sessions() as db:
        run_start = db.get_one(Activity, context.ids["run"]).start_utc
    path = tmp_path / "export.zip"
    path.write_bytes(strava_export(run_start))
    with context.sessions.begin() as db:
        row = ImportRow(user_id=owner_id(context), filename="export.zip", size=1, status="queued")
        db.add(row)
    run_import(context.sessions, context.store, PhotoStore(settings.data_dir / "photos"), row.id, path)
    with context.sessions() as db:
        saved = db.get_one(ImportRow, row.id)
        assert (saved.status, saved.kind, saved.total, saved.processed) == ("done", "strava", 4, 4)
        assert (saved.created, saved.merged, saved.failed, saved.photos) == (3, 1, 0, 1), saved.errors
        assert db.scalar(select(func.count()).where(Activity.source == "strava")) == 3
    assert not path.exists()


def test_deleting_an_activity_removes_it_its_photos_and_keeps_the_sync_from_bringing_it_back(
    m4: tuple[Ctx, Settings],
) -> None:
    from zankup.sync.orchestrator import _known_ids

    context, settings = m4
    run_id = context.ids["run"]
    photo = context.http.post(
        f"/api/activities/{run_id}/photos", content=jpeg_with_gps(), headers={"Content-Type": "image/jpeg"}
    ).json()
    with context.sessions() as db:
        key = db.get_one(Photo, photo["id"]).key
        external_id, user_id = db.get_one(Activity, run_id).external_id, db.get_one(Activity, run_id).user_id
    assert PhotoStore(settings.data_dir / "photos").path(key).exists()

    assert context.http.delete(f"/api/activities/{context.other_id}").status_code == 404
    assert context.http.delete(f"/api/activities/{run_id}").status_code == 204
    assert context.http.get(f"/api/activities/{run_id}").status_code == 404
    assert context.http.delete(f"/api/activities/{run_id}").status_code == 404
    assert not PhotoStore(settings.data_dir / "photos").path(key).exists()
    with context.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Photo).where(Photo.activity_id == run_id)) == 0
        assert external_id in _known_ids(db, user_id)
        assert db.scalar(select(Job).where(Job.kind == "metrics_full", Job.status == "queued")) is not None


def test_one_habitual_gear_per_kind_and_new_activities_prefer_it(ctx: Ctx) -> None:  # noqa: F811
    def make(name: str, kind: str = "bike", **extra: Any) -> dict[str, Any]:
        body = {"name": name, "kind": kind, "sports": ["ride" if kind == "bike" else "run"], **extra}
        answer = ctx.http.post("/api/gear", json=body)
        assert answer.status_code in (200, 201), answer.text
        return answer.json()

    def habitual() -> dict[str, bool]:
        return {g["name"]: g["habitual"] for g in ctx.http.get("/api/gear").json()}

    road = make("Road bike", habitual=True)
    gravel = make("Gravel bike")
    shoes = make("Shoes", kind="shoe", habitual=True)
    assert road["habitual"] and not gravel["habitual"] and shoes["habitual"]

    # The newest bike is the default for rides unless one is habitual.
    with ctx.sessions.begin() as db:
        assert default_gear(db, owner_id(ctx), "ride") == road["id"]
    ctx.http.patch(f"/api/gear/{gravel['id']}", json={"habitual": True})
    assert habitual() == {"Road bike": False, "Gravel bike": True, "Shoes": True}  # shoes keep theirs
    with ctx.sessions.begin() as db:
        assert default_gear(db, owner_id(ctx), "ride") == gravel["id"]

    # Retiring it leaves no habitual bike.
    ctx.http.patch(f"/api/gear/{gravel['id']}", json={"retired": True})
    assert habitual()["Gravel bike"] is False
