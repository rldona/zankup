import stat
from pathlib import Path

import pytest

from zankup.core.config import Settings
from zankup.storage import (
    ImmutableFileError,
    IntegrityError,
    LocalRawStore,
    StorageError,
    get_raw_store,
    raw_key,
    sha256,
)

FIT = (Path(__file__).resolve().parents[2] / "fixtures" / "fit" / "run.fit").read_bytes()


def test_keys_identify_user_source_and_activity() -> None:
    assert raw_key(1, "garmin", "9000000002") == "1/garmin/9000000002.fit"
    assert raw_key(1, "strava", "123", ".gpx") == "1/strava/123.gpx"
    for bad in ("../etc", "a b", "x/../../y"):
        with pytest.raises(StorageError):
            raw_key(1, "garmin", bad)


def test_put_and_get_round_trip(tmp_path: Path) -> None:
    store = LocalRawStore(tmp_path)
    key = raw_key(1, "garmin", "9000000002")
    stored = store.put(key, FIT)
    assert stored.sha256 == sha256(FIT) and stored.size == len(FIT)
    assert store.exists(key) and store.get(key, stored.sha256) == FIT


def test_files_are_read_only_and_writes_leave_no_temporaries(tmp_path: Path) -> None:
    store = LocalRawStore(tmp_path)
    store.put("1/garmin/1.fit", FIT)
    path = tmp_path / "1" / "garmin" / "1.fit"
    assert stat.S_IMODE(path.stat().st_mode) == 0o444
    assert [p.name for p in path.parent.iterdir()] == ["1.fit"]


def test_originals_are_immutable(tmp_path: Path) -> None:
    store = LocalRawStore(tmp_path)
    store.put("1/garmin/1.fit", FIT)
    assert store.put("1/garmin/1.fit", FIT).sha256 == sha256(FIT)  # same content: fine, nothing rewritten
    with pytest.raises(ImmutableFileError):
        store.put("1/garmin/1.fit", FIT + b"changed")
    assert store.get("1/garmin/1.fit") == FIT


def test_detects_corruption_and_missing_files(tmp_path: Path) -> None:
    store = LocalRawStore(tmp_path)
    stored = store.put("1/garmin/1.fit", FIT)
    path = tmp_path / "1" / "garmin" / "1.fit"
    path.chmod(0o644)
    path.write_bytes(FIT[:-10])
    with pytest.raises(IntegrityError):
        store.get("1/garmin/1.fit", stored.sha256)
    with pytest.raises(StorageError):
        store.get("1/garmin/2.fit")


def test_store_lives_under_data_dir_raw(tmp_path: Path) -> None:
    store = get_raw_store(Settings(_env_file=None, data_dir=tmp_path))  # type: ignore[call-arg]
    assert isinstance(store, LocalRawStore) and store.root == tmp_path / "raw"
