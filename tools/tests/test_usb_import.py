"""The USB import (OS-608): finding the watch, sending only new files, and the upload flow."""

import io
import json
import zipfile
from pathlib import Path

import httpx
import pytest
import respx
import usb_import

FIT = b"\x0e\x10\x00\x00\x00\x00\x00\x00.FIT" + b"\x00" * 20


def watch(tmp_path: Path, *names: str) -> Path:
    garmin = tmp_path / "media" / "me" / "FENIX" / "GARMIN"
    (garmin / "Activity").mkdir(parents=True)
    for i, name in enumerate(names):
        (garmin / "Activity" / name).write_bytes(FIT + bytes([i]))
    (garmin / "Activity" / "notes.txt").write_text("not a FIT")
    return garmin


def test_finds_the_watch_and_only_new_fit_files(tmp_path: Path) -> None:
    garmin = watch(tmp_path, "A1.FIT", "A2.fit")
    assert usb_import.find_garmin([str(tmp_path / "media" / "me")]) == garmin
    assert usb_import.find_garmin([str(tmp_path / "nowhere")]) is None
    files = usb_import.new_files(garmin, set())
    assert sorted(f.name for f, _, _ in files) == ["A1.FIT", "A2.fit"]
    assert usb_import.new_files(garmin, {files[0][2]}) == files[1:]
    with zipfile.ZipFile(io.BytesIO(usb_import.pack(files))) as archive:
        assert sorted(archive.namelist()) == ["A1.FIT", "A2.fit"]


def test_state_survives_a_bad_file(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    assert usb_import.load_state(path) == set()
    usb_import.save_state({"b", "a"}, path)
    assert json.loads(path.read_text()) == {"sent": ["a", "b"]} and usb_import.load_state(path) == {"a", "b"}
    path.write_text("{")
    assert usb_import.load_state(path) == set()


@respx.mock
def test_signs_in_uploads_in_parts_and_signs_out() -> None:
    api = "https://api.example.test"
    respx.post(f"{api}/api/auth/login").respond(json={"mfa_required": True, "challenge": "c"})
    totp = respx.post(f"{api}/api/auth/login/totp").respond(json={"access_token": "t", "refresh_token": "r"})
    respx.post(f"{api}/api/imports").respond(
        201,
        json={
            "import": {"id": 9},
            "upload": {"url": f"{api}/api/direct/uploads/9", "token": "u", "part_size": 4},
        },
    )
    parts = respx.put(url__regex=rf"{api}/api/direct/uploads/9/\d+").respond(204)
    finish = respx.post(f"{api}/api/imports/9/finish").respond(json={"id": 9, "status": "queued"})
    states = iter([{"status": "running"}, {"status": "done", "created": 2, "merged": 0, "skipped": 0}])
    respx.get(f"{api}/api/imports/9").mock(side_effect=lambda _: httpx.Response(200, json=next(states)))
    logout = respx.post(f"{api}/api/auth/logout").respond(204)

    zankup = usb_import.Zankup(api)
    zankup.sign_in("me@example.test", "secret", lambda: "123456")
    assert json.loads(totp.calls.last.request.content) == {"challenge": "c", "code": "123456"}
    assert zankup.upload("watch.zip", b"0123456789") == 9
    assert parts.call_count == 3 and parts.calls.last.request.content == b"89"
    assert finish.calls.last.request.headers["Authorization"] == "Bearer t"
    assert zankup.wait(9, sleep=lambda _: None)["created"] == 2
    zankup.sign_out()
    assert logout.called and zankup.token is None


@respx.mock
def test_a_rejected_sign_in_stops_with_the_reason() -> None:
    respx.post("https://api.example.test/api/auth/login").respond(
        401, json={"detail": "Wrong e-mail or password"}
    )
    with pytest.raises(SystemExit, match="Wrong e-mail or password"):
        usb_import.Zankup("https://api.example.test").sign_in("a", "b", lambda: "")


def test_without_a_watch_it_says_so(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert usb_import.main([str(tmp_path / "missing")]) == 1
    assert "No watch found" in capsys.readouterr().err


def test_dry_run_lists_what_would_be_sent(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(usb_import, "STATE", tmp_path / "state.json")
    garmin = watch(tmp_path, "A1.FIT")
    assert usb_import.main([str(garmin), "--dry-run"]) == 0
    assert "1 new activity" in capsys.readouterr().out
