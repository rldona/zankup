"""Run a Garmin sync from the command line: `python -m opensport.sync [--since YYYY-MM-DD] [--no-wait]`.

By default it also processes the queued imports before exiting, so one command brings new activities
all the way into the database (what the cron does too, OS-109).
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from sqlalchemy.orm import sessionmaker

from opensport.core.config import get_settings
from opensport.core.logging import configure_logging
from opensport.db.session import get_engine
from opensport.jobs.handlers import default_handlers
from opensport.jobs.worker import Worker
from opensport.storage import get_raw_store
from opensport.sync.garmin import GarminClient, GarminError
from opensport.sync.orchestrator import SyncAlreadyRunning, run_sync
from opensport.sync.tokens import DbTokenCache
from opensport.users import ensure_owner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m opensport.sync", description="Sync Garmin activities")
    parser.add_argument("--since", type=date.fromisoformat, help="list from this date (YYYY-MM-DD)")
    parser.add_argument("--trigger", default="cron", choices=["cron", "button", "initial", "import"])
    parser.add_argument(
        "--no-wait", action="store_true", help="queue the imports and leave them to the worker"
    )
    args = parser.parse_args(argv)

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

    try:
        result = run_sync(sessions, store, garmin, user_id=user_id, trigger=args.trigger, since=args.since)
    except SyncAlreadyRunning as error:
        print(error, file=sys.stderr)
        return 1
    except GarminError as error:
        print(f"Garmin API error: {error}", file=sys.stderr)
        return 1
    print(f"Listed {result.listed}, queued {result.queued} new, skipped {result.skipped} already known")

    if not args.no_wait and result.queued:
        worker = Worker(sessions, default_handlers(store), name="sync-cli")
        processed = 0
        while worker.run_once():
            processed += 1
        print(f"Processed {processed} jobs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
