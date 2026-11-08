"""Run a Garmin sync from the command line.

    python -m zankup.sync                      # what is new since the last sync
    python -m zankup.sync --since 2019-01-01   # everything from that day (OS-113)
    python -m zankup.sync --all                # the whole Garmin Connect history

Long ranges are listed in date windows, oldest first, with a pause between downloads (`--pause`). The
imports run in a background thread while the download goes on, so activities appear as it advances.
An interrupted load is safe to run again: what is already downloaded or imported is skipped. With
`--no-wait` the imports are left to the API's worker instead.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from sqlalchemy.orm import sessionmaker

from zankup.alerts import email_sender
from zankup.core.config import get_settings
from zankup.core.logging import configure_logging
from zankup.db.session import get_engine
from zankup.jobs.handlers import default_handlers
from zankup.jobs.worker import Worker
from zankup.storage import get_raw_store
from zankup.sync.garmin import GarminClient, GarminError
from zankup.sync.orchestrator import SyncAlreadyRunning, run_sync
from zankup.sync.tokens import DbTokenCache
from zankup.users import ensure_owner

HISTORY_START = date(2000, 1, 1)  # before any Garmin Connect activity


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m zankup.sync", description="Sync Garmin activities")
    since = parser.add_mutually_exclusive_group()
    since.add_argument("--since", type=date.fromisoformat, help="list from this date (YYYY-MM-DD)")
    since.add_argument("--all", action="store_true", help="the whole Garmin Connect history")
    parser.add_argument("--trigger", choices=["cron", "button", "initial", "import"])
    parser.add_argument("--pause", type=float, default=1.0, help="seconds between downloads (default 1)")
    parser.add_argument(
        "--no-wait", action="store_true", help="queue the imports and leave them to the worker"
    )
    args = parser.parse_args(argv)
    start = HISTORY_START if args.all else args.since
    trigger = args.trigger or ("initial" if start else "cron")

    settings = get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)
    if settings.garmin_personal_api_key is None:
        print("GARMIN_PERSONAL_API_KEY is not set", file=sys.stderr)
        return 2
    sessions = sessionmaker(get_engine(), expire_on_commit=False)
    with sessions.begin() as session:
        user_id = ensure_owner(session, settings.owner_email).id
    store = get_raw_store(settings)
    garmin = GarminClient(
        settings.garmin_personal_api_key.get_secret_value(), DbTokenCache(sessions, user_id)
    )
    worker = None if args.no_wait else Worker(sessions, default_handlers(store), name="sync-cli")
    thread = worker.start_thread() if worker else None

    try:
        result = run_sync(
            sessions,
            store,
            garmin,
            user_id=user_id,
            trigger=trigger,
            since=start,
            pause_s=args.pause,
            alert=email_sender(settings),
        )
    except SyncAlreadyRunning as error:
        print(error, file=sys.stderr)
        return 1
    except GarminError as error:
        print(f"Garmin API error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted: run it again to carry on where it stopped", file=sys.stderr)
        return 130
    finally:
        if worker and thread:
            worker.stop()
            thread.join()
    print(f"Listed {result.listed}, queued {result.queued} new, skipped {result.skipped} already known")

    if worker:
        processed = 0
        while worker.run_once():  # whatever the thread had not reached yet
            processed += 1
        print(f"Imports finished ({processed} after the download ended)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
